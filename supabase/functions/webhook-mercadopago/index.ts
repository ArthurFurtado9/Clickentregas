import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders })
  }

  // Permite GET para teste rápido no navegador / ping do webhook
  if (req.method === "GET") {
    return new Response(
      JSON.stringify({ status: "Webhook ClickEntregas está online e pronto!" }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    )
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? ""
    const supabaseServiceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    const mpAccessToken = Deno.env.get("MP_ACCESS_TOKEN") ?? ""

    const url = new URL(req.url)
    let body: any = {}
    try {
      body = await req.json()
    } catch {
      // Alguns pings do MP chegam sem body JSON
    }

    // O Mercado Pago pode enviar o ID do pagamento via query params (?data.id=... ou ?id=...) ou no corpo JSON
    const paymentId = 
      body?.data?.id || 
      body?.id || 
      url.searchParams.get("data.id") || 
      url.searchParams.get("id")

    const action = body?.action || body?.type || url.searchParams.get("type") || ""

    console.log(`[Webhook MP] Notificação recebida. Action: ${action}, PaymentId: ${paymentId}`)

    if (!paymentId) {
      // Responde 200 para eventos que não são de pagamento (ex: merchant_order, etc)
      return new Response(
        JSON.stringify({ message: "Evento recebido sem payment_id, ignorado com sucesso" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      )
    }

    // 1. Consulta a API oficial do Mercado Pago para conferir se o pagamento é legítimo (Anti-Fraude)
    const mpRes = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${mpAccessToken}`
      }
    })

    if (!mpRes.ok) {
      console.error(`[Webhook MP] Falha ao consultar pagamento ${paymentId} no Mercado Pago:`, await mpRes.text())
      return new Response(
        JSON.stringify({ error: "Não foi possível validar o pagamento junto ao Mercado Pago" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      )
    }

    const payment = await mpRes.json()
    console.log(`[Webhook MP] Status do pagamento ${paymentId}: ${payment.status}, Ref: ${payment.external_reference}`)

    // Só dá baixa se o status for realmente 'approved'
    if (payment.status === "approved") {
      const orderId = payment.external_reference
      const paidAmount = Number(payment.transaction_amount)

      const supabase = createClient(supabaseUrl, supabaseServiceRole)

      // 2. Busca o pedido correspondente (pelo ID do pedido ou pelo mp_payment_id)
      let query = supabase.from("orders").select("id, total_price, payment_status")
      if (orderId) {
        query = query.eq("id", orderId)
      } else {
        query = query.eq("mp_payment_id", String(paymentId))
      }

      const { data: order, error: orderErr } = await query.maybeSingle()

      if (orderErr || !order) {
        console.warn(`[Webhook MP] Pedido não encontrado para payment ${paymentId}`)
        return new Response(
          JSON.stringify({ message: "Pedido não localizado no banco de dados" }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        )
      }

      // Se já estiver pago, não precisa atualizar de novo (Idempotência)
      if (order.payment_status === "paid") {
        console.log(`[Webhook MP] Pedido ${order.id} já estava como pago anteriormente.`)
        return new Response(
          JSON.stringify({ message: "Pedido já registrado como pago" }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        )
      }

      // 3. Atualiza o status do pedido para 'paid' usando o Service Role (que passa pela trigger com segurança)
      const { error: updateErr } = await supabase
        .from("orders")
        .update({
          payment_status: "paid",
          paid_at: new Date().toISOString(),
          mp_payment_id: String(paymentId)
        })
        .eq("id", order.id)

      if (updateErr) {
        console.error(`[Webhook MP] Erro ao atualizar pedido ${order.id}:`, updateErr)
        return new Response(
          JSON.stringify({ error: "Erro ao atualizar status do pedido" }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        )
      }

      console.log(`[Webhook MP] SUCESSO: Pedido ${order.id} marcado como PAGO automaticamente!`)
    }

    // Sempre retorna HTTP 200 para o Mercado Pago não ficar reenviando o mesmo webhook
    return new Response(
      JSON.stringify({ success: true, payment_status: payment.status }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    )
  } catch (err) {
    console.error("[Webhook MP] Erro inesperado:", err)
    return new Response(
      JSON.stringify({ error: err.message || "Erro desconhecido" }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    )
  }
})
