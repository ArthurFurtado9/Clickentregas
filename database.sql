-- ─── CLICKENTREGAS DATABASE SETUP & SECURITY HARDENING SCRIPT ───
-- Execute este script no SQL Editor do seu Supabase Dashboard para configurar
-- o esquema de banco de dados, funções auxiliares, triggers de segurança e RLS.

-- ─── 1. CRIAÇÃO DO ESQUEMA PRIVADO ───
CREATE SCHEMA IF NOT EXISTS private;

-- ─── 2. FUNÇÕES INTERNAS NO ESQUEMA PRIVADO ───

-- Busca o hash da senha do administrador (Apenas interno)
CREATE OR REPLACE FUNCTION private.get_admin_password_hash()
RETURNS text AS $$
BEGIN
  RETURN (SELECT value FROM public.settings WHERE key = 'admin_password');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION private.get_admin_password_hash() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.get_admin_password_hash() TO service_role, postgres;

-- Recalcula o subtotal, descontos e total de um pedido no servidor (Gatilho interno)
CREATE OR REPLACE FUNCTION private.recalculate_order_total()
RETURNS TRIGGER AS $$
DECLARE
  v_order_id bigint;
  v_total numeric(10,2) := 0;
  v_subtotal numeric(10,2) := 0;
  v_discount numeric(10,2) := 0;
  v_coupon_code text;
  v_discount_type text;
  v_discount_value numeric(10,2);
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_order_id := OLD.order_id;
  ELSE
    v_order_id := NEW.order_id;
  END IF;

  SELECT COALESCE(SUM(oi.quantity * p.price), 0)
  INTO v_subtotal
  FROM public.order_items oi
  JOIN public.products p ON oi.product_id = p.id
  WHERE oi.order_id = v_order_id;

  SELECT coupon_code, COALESCE(discount, 0)
  INTO v_coupon_code, v_discount
  FROM public.orders
  WHERE id = v_order_id;

  IF v_coupon_code IS NOT NULL THEN
    SELECT discount_type, discount_value
    INTO v_discount_type, v_discount_value
    FROM public.coupons
    WHERE code = v_coupon_code AND is_active = true;

    IF v_discount_type = 'percentage' THEN
      v_discount := v_subtotal * (v_discount_value / 100);
    ELSIF v_discount_type = 'fixed' THEN
      v_discount := v_discount_value;
    END IF;
  END IF;

  IF v_discount > v_subtotal THEN
    v_discount := v_subtotal;
  END IF;

  v_total := v_subtotal - v_discount;

  UPDATE public.orders
  SET total_price = GREATEST(0, v_total),
      discount = v_discount
  WHERE id = v_order_id;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION private.recalculate_order_total() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.recalculate_order_total() TO service_role, postgres;

-- ─── 3. REMOÇÃO DAS FUNÇÕES DO ESQUEMA PÚBLICO E GATILHOS ANTIGOS ───
DROP FUNCTION IF EXISTS public.recalculate_order_total() CASCADE;
DROP FUNCTION IF EXISTS public.get_admin_password_hash() CASCADE;

-- ─── 4. CRIAÇÃO DE GATILHOS NO BANCO ───
DROP TRIGGER IF EXISTS trigger_recalculate_order_total ON order_items;
CREATE TRIGGER trigger_recalculate_order_total
AFTER INSERT OR UPDATE OR DELETE ON order_items
FOR EACH ROW EXECUTE FUNCTION private.recalculate_order_total();

-- ─── 5. RPCs DO ESQUEMA PÚBLICO COM SEARCH_PATH FIXO E PERMISSÕES ESTRITAS ───

-- 5.1 Decremento de Estoque Atômico
CREATE OR REPLACE FUNCTION public.decrement_stock(p_product_id uuid, p_qty numeric)
RETURNS boolean AS $$
DECLARE
  v_current_stock numeric;
BEGIN
  IF p_qty <= 0 THEN
    RETURN true;
  END IF;

  SELECT stock INTO v_current_stock
  FROM public.products
  WHERE id = p_product_id
  FOR UPDATE;

  IF v_current_stock IS NULL THEN
    -- Produto com estoque não controlado
    RETURN true;
  END IF;

  IF v_current_stock < p_qty THEN
    RETURN false;
  END IF;

  UPDATE public.products
  SET stock = stock - p_qty
  WHERE id = p_product_id;

  RETURN true;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION public.decrement_stock(uuid, numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.decrement_stock(uuid, numeric) TO anon, authenticated, service_role;

-- 5.2 Verifica se a senha de administrador já está configurada
CREATE OR REPLACE FUNCTION public.is_admin_password_set()
RETURNS boolean AS $$
BEGIN
  RETURN EXISTS (SELECT 1 FROM public.settings WHERE key = 'admin_password');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION public.is_admin_password_set() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_admin_password_set() TO anon, authenticated, service_role;

-- 5.3 Valida se o hash enviado é idêntico ao cadastrado
CREATE OR REPLACE FUNCTION public.verify_admin_password(password_hash text)
RETURNS boolean AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.settings 
    WHERE key = 'admin_password' AND value = password_hash
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION public.verify_admin_password(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.verify_admin_password(text) TO anon, authenticated, service_role;

-- 5.4 Insere a senha de admin pela primeira vez
CREATE OR REPLACE FUNCTION public.set_admin_password(new_hash text)
RETURNS boolean AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.settings WHERE key = 'admin_password') THEN
    RETURN false;
  END IF;
  
  INSERT INTO public.settings (key, value, updated_at)
  VALUES ('admin_password', new_hash, now())
  ON CONFLICT (key) DO UPDATE SET value = new_hash, updated_at = now();
  
  RETURN true;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION public.set_admin_password(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_admin_password(text) TO anon, authenticated, service_role;

-- ─── 6. POLÍTICAS DE RLS (ROW LEVEL SECURITY) ───

-- Tabela settings
ALTER TABLE settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Permitir leitura de config publica" ON settings;
DROP POLICY IF EXISTS "Admin controla config" ON settings;
CREATE POLICY "Permitir leitura de config publica" ON settings FOR SELECT TO anon USING (key <> 'admin_password');
CREATE POLICY "Admin controla config" ON settings FOR ALL TO anon
  USING (current_setting('request.headers', true)::json->>'x-admin-key' = private.get_admin_password_hash())
  WITH CHECK (current_setting('request.headers', true)::json->>'x-admin-key' = private.get_admin_password_hash());

-- Tabela products
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Leitura de produtos publica" ON products;
DROP POLICY IF EXISTS "Admin gerencia produtos" ON products;
CREATE POLICY "Leitura de produtos publica" ON products FOR SELECT TO anon USING (true);
CREATE POLICY "Admin gerencia produtos" ON products FOR ALL TO anon
  USING (current_setting('request.headers', true)::json->>'x-admin-key' = private.get_admin_password_hash())
  WITH CHECK (current_setting('request.headers', true)::json->>'x-admin-key' = private.get_admin_password_hash());

-- Tabela coupons
ALTER TABLE coupons ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Leitura de cupons publica" ON coupons;
DROP POLICY IF EXISTS "Admin gerencia cupons" ON coupons;
CREATE POLICY "Leitura de cupons publica" ON coupons FOR SELECT TO anon USING (true);
CREATE POLICY "Admin gerencia cupons" ON coupons FOR ALL TO anon
  USING (current_setting('request.headers', true)::json->>'x-admin-key' = private.get_admin_password_hash())
  WITH CHECK (current_setting('request.headers', true)::json->>'x-admin-key' = private.get_admin_password_hash());

-- Tabela customers
ALTER TABLE customers ADD COLUMN IF NOT EXISTS active_cart jsonb;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS cart_updated_at timestamptz;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS password_hash text;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS recovery_code text;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS recovery_expires timestamptz;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS security_question text;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS security_answer_hash text;

ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Leitura restrita cliente" ON customers;
DROP POLICY IF EXISTS "Cadastro de cliente publico" ON customers;
DROP POLICY IF EXISTS "Edicao de perfil cliente" ON customers;
CREATE POLICY "Leitura restrita cliente" ON customers FOR SELECT TO anon
  USING (
    current_setting('request.headers', true)::json->>'x-admin-key' = private.get_admin_password_hash() OR
    phone = current_setting('request.headers', true)::json->>'x-client-phone'
  );
CREATE POLICY "Cadastro de cliente publico" ON customers FOR INSERT TO anon 
  WITH CHECK (phone = current_setting('request.headers', true)::json->>'x-client-phone');
CREATE POLICY "Edicao de perfil cliente" ON customers FOR UPDATE TO anon
  USING (
    current_setting('request.headers', true)::json->>'x-admin-key' = private.get_admin_password_hash() OR
    phone = current_setting('request.headers', true)::json->>'x-client-phone'
  )
  WITH CHECK (
    current_setting('request.headers', true)::json->>'x-admin-key' = private.get_admin_password_hash() OR
    phone = current_setting('request.headers', true)::json->>'x-client-phone'
  );

-- Tabela orders
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Leitura restrita pedidos" ON orders;
DROP POLICY IF EXISTS "Clientes fazem pedidos" ON orders;
DROP POLICY IF EXISTS "Admin gerencia pedidos" ON orders;
CREATE POLICY "Leitura restrita pedidos" ON orders FOR SELECT TO anon
  USING (
    current_setting('request.headers', true)::json->>'x-admin-key' = private.get_admin_password_hash() OR
    customer_id IN (SELECT id FROM customers WHERE phone = current_setting('request.headers', true)::json->>'x-client-phone')
  );
CREATE POLICY "Clientes fazem pedidos" ON orders FOR INSERT TO anon 
  WITH CHECK (
    customer_id IN (
      SELECT id FROM customers 
      WHERE phone = current_setting('request.headers', true)::json->>'x-client-phone'
    )
  );
CREATE POLICY "Admin gerencia pedidos" ON orders FOR UPDATE TO anon
  USING (current_setting('request.headers', true)::json->>'x-admin-key' = private.get_admin_password_hash())
  WITH CHECK (current_setting('request.headers', true)::json->>'x-admin-key' = private.get_admin_password_hash());

-- Tabela order_items
ALTER TABLE order_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Leitura restrita itens" ON order_items;
DROP POLICY IF EXISTS "Insercao de itens publica" ON order_items;
DROP POLICY IF EXISTS "Admin gerencia itens" ON order_items;
CREATE POLICY "Leitura restrita itens" ON order_items FOR SELECT TO anon
  USING (
    current_setting('request.headers', true)::json->>'x-admin-key' = private.get_admin_password_hash() OR
    order_id IN (SELECT id FROM orders WHERE customer_id IN (SELECT id FROM customers WHERE phone = current_setting('request.headers', true)::json->>'x-client-phone'))
  );
CREATE POLICY "Insercao de itens publica" ON order_items FOR INSERT TO anon 
  WITH CHECK (
    order_id IN (
      SELECT id FROM orders 
      WHERE customer_id IN (
        SELECT id FROM customers 
        WHERE phone = current_setting('request.headers', true)::json->>'x-client-phone'
      )
    )
  );
CREATE POLICY "Admin gerencia itens" ON order_items FOR ALL TO anon
  USING (current_setting('request.headers', true)::json->>'x-admin-key' = private.get_admin_password_hash())
  WITH CHECK (current_setting('request.headers', true)::json->>'x-admin-key' = private.get_admin_password_hash());
