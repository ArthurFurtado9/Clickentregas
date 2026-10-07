import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-client-phone, x-admin-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders })
  }

  try {
    const { order_id } = await req.json()

    if (!order_id) {
      return new Response(
        JSON.stringify({ error: "order_id é obrigatório" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      )
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? ""
    const supabaseServiceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    const mpAccessToken = Deno.env.get("MP_ACCESS_TOKEN") ?? ""

    if (!mpAccessToken) {
      return new Response(
        JSON.stringify({ error: "Secret MP_ACCESS_TOKEN não configurado no Supabase" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      )
    }

    const supabase = createClient(supabaseUrl, supabaseServiceRole)

    // 1. Busca os dados reais do pedido direto no banco de dados (Prevenção de fraude de valores)
    const { data: order, error: orderError } = await supabase
      .from("orders")
      .select("*, customers(*)")
      .eq("id", order_id)
      .single()

    if (orderError || !order) {
      return new Response(
        JSON.stringify({ error: "Pedido não encontrado" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      )
    }

    if (order.payment_status === "paid") {
      return new Response(
        JSON.stringify({ 
          success: true, 
          message: "Este pedido já foi pago!", 
          already_paid: true 
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      )
    }

    // Se já tiver um Pix gerado e que ainda não expirou (menos de 24h), reaproveita o mesmo
    if (
      order.pix_copia_cola && 
      order.pix_expires_at && 
      new Date(order.pix_expires_at) > new Date()
    ) {
      return new Response(
        JSON.stringify({
          success: true,
          mp_payment_id: order.mp_payment_id,
          pix_qr_code: order.pix_qr_code,
          pix_copia_cola: order.pix_copia_cola,
          pix_ticket_url: order.pix_ticket_url,
          pix_expires_at: order.pix_expires_at,
          amount: order.total_price !== undefined && order.total_price !== null ? order.total_price : order.total
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      )
    }

    const rawTotal = order.total_price !== undefined && order.total_price !== null ? order.total_price : order.total
    const amount = Number(parseFloat(rawTotal).toFixed(2))
    if (isNaN(amount) || amount <= 0) {
      return new Response(
        JSON.stringify({ error: `Valor total do pedido inválido para cobrança (recebido: ${rawTotal})` }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      )
    }

    // 2. Monta payload para a API do Mercado Pago
    const rawName = (order.customers?.name || "Cliente").trim()
    const cleanName = rawName.replace(/[^a-zA-ZÀ-ÿ0-9 ]/g, '').trim() || "Cliente"
    const nameParts = cleanName.split(/\s+/)
    const firstName = (nameParts[0] || "Cliente").substring(0, 30)
    const lastName = (nameParts.slice(1).join(" ") || "Cliente").substring(0, 30)

    const customerIdentifier = (order.customers?.phone || order.id.substring(0, 8)).replace(/\D/g, '') || order.id.substring(0, 8)
    const clientEmail = `cliente_${customerIdentifier}@clickentregas.com`
    const shortId = order.id.substring(0, 8).toUpperCase()

    const expirationDate = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() // 24 horas

    const mpPayload = {
      transaction_amount: amount,
      description: `Pedido #${shortId} - ClickEntregas`,
      payment_method_id: "pix",
      payer: {
        email: clientEmail,
        first_name: firstName,
        last_name: lastName
      },
      external_reference: order.id,
      date_of_expiration: expirationDate,
      notification_url: `${supabaseUrl}/functions/v1/webhook-mercadopago`
    }

    // 3. Chamada ao Mercado Pago
    const mpRes = await fetch("https://api.mercadopago.com/v1/payments", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${mpAccessToken}`,
        "Content-Type": "application/json",
        "X-Idempotency-Key": `order_${order.id}_${Date.now()}`
      },
      body: JSON.stringify(mpPayload)
    })

    const mpData = await mpRes.json()

    if (!mpRes.ok) {
      console.error("Erro Mercado Pago:", mpData)
      return new Response(
        JSON.stringify({ 
          error: "Erro ao gerar cobrança no Mercado Pago", 
          details: mpData.message || mpData 
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      )
    }

    const qrCodeBase64 = mpData.point_of_interaction?.transaction_data?.qr_code_base64 || ""
    const qrCodeCopiaCola = mpData.point_of_interaction?.transaction_data?.qr_code || ""
    const ticketUrl = mpData.point_of_interaction?.transaction_data?.ticket_url || ""

    // 4. Salva no banco de dados
    const { error: updateError } = await supabase
      .from("orders")
      .update({
        mp_payment_id: String(mpData.id),
        pix_qr_code: qrCodeBase64,
        pix_copia_cola: qrCodeCopiaCola,
        pix_ticket_url: ticketUrl,
        pix_expires_at: expirationDate
      })
      .eq("id", order.id)

    if (updateError) {
      console.error("Erro ao salvar Pix no pedido:", updateError)
    }

    return new Response(
      JSON.stringify({
        success: true,
        mp_payment_id: String(mpData.id),
        pix_qr_code: qrCodeBase64,
        pix_copia_cola: qrCodeCopiaCola,
        pix_ticket_url: ticketUrl,
        pix_expires_at: expirationDate,
        amount: amount
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    )
  } catch (err) {
    console.error("Erro interno:", err)
    return new Response(
      JSON.stringify({ error: err.message || "Erro desconhecido" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    )
  }
})
