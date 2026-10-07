-- ─── ATUALIZAÇÃO: BAIXA AUTOMÁTICA VIA MERCADO PAGO & SEGURANÇA ───
-- Execute este script no SQL Editor do Supabase:
-- https://supabase.com/dashboard/project/xtrmqjukywcaheucnhez/sql/new

-- 1. Novas colunas na tabela orders para controle de pagamento automático
ALTER TABLE public.orders 
  ADD COLUMN IF NOT EXISTS mp_payment_id text,
  ADD COLUMN IF NOT EXISTS pix_qr_code text,
  ADD COLUMN IF NOT EXISTS pix_copia_cola text,
  ADD COLUMN IF NOT EXISTS pix_ticket_url text,
  ADD COLUMN IF NOT EXISTS pix_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS paid_at timestamptz;

-- 2. Índice para consultas rápidas do Webhook por ID do Mercado Pago
CREATE INDEX IF NOT EXISTS idx_orders_mp_payment_id ON public.orders(mp_payment_id);

-- 3. Blindagem de Segurança (Trigger):
-- Impede que chamadas diretas de clientes anônimos alterem 'payment_status' para 'paid'.
-- Apenas chamadas do Administrador ou Service Role (Edge Function) podem confirmar o pagamento.
CREATE OR REPLACE FUNCTION public.check_order_payment_update_security()
RETURNS TRIGGER AS $$
DECLARE
  v_admin_key text;
  v_expected_hash text;
BEGIN
  -- Se o status de pagamento não está mudando para 'paid', permite a edição normal (ex: montagem/itens)
  IF NEW.payment_status = OLD.payment_status THEN
    RETURN NEW;
  END IF;

  -- Se está mudando o payment_status:
  -- Verifica se é o Service Role (Edge Function do Webhook tem role service_role ou auth.role() = 'service_role')
  IF current_setting('request.jwt.claim.role', true) = 'service_role' OR auth.role() = 'service_role' THEN
    RETURN NEW;
  END IF;

  -- Verifica se é o Administrador com a chave correta
  v_admin_key := current_setting('request.headers', true)::json->>'x-admin-key';
  v_expected_hash := private.get_admin_password_hash();

  IF v_admin_key IS NOT NULL AND v_admin_key = v_expected_hash THEN
    RETURN NEW;
  END IF;

  -- Se for um cliente comum tentando alterar payment_status, bloqueia:
  RAISE EXCEPTION 'Apenas o sistema de pagamentos ou o administrador podem alterar o status de pagamento.';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_check_order_payment_update_security ON public.orders;
CREATE TRIGGER trg_check_order_payment_update_security
  BEFORE UPDATE OF payment_status ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.check_order_payment_update_security();
