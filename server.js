import express from "express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import dotenv from "dotenv";
import pg from "pg";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

dotenv.config();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = Number(process.env.PORT || 3000);
const HANDLE = (process.env.INFINITEPAY_HANDLE || "leandroartefinalista").replace(/^\$/, "");
const API_KEY = process.env.INFINITEPAY_API_KEY || "";
const BASE_URL = (process.env.PUBLIC_BASE_URL || "").replace(/\/$/, "");
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : undefined });
const products = JSON.parse(fs.readFileSync(path.join(__dirname, "data", "products.json"), "utf8"));

app.set("trust proxy", 1);
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: "100kb" }));
app.use("/api/", rateLimit({ windowMs: 60_000, limit: 60, standardHeaders: "draft-7", legacyHeaders: false }));
app.use(express.static(path.join(__dirname, "public")));

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS orders (
      id UUID PRIMARY KEY,
      access_token TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      customer_name TEXT NOT NULL,
      customer_email TEXT NOT NULL,
      items JSONB NOT NULL,
      amount_cents INTEGER NOT NULL,
      checkout_url TEXT,
      transaction_nsu TEXT,
      invoice_slug TEXT,
      capture_method TEXT,
      receipt_url TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

function publicOrigin(req) {
  if (BASE_URL) return BASE_URL;
  throw new Error("Configure PUBLIC_BASE_URL com o endereço HTTPS público da loja.");
}
function moneyBRL(cents) { return (cents / 100).toFixed(2); }

app.post("/api/checkout", async (req, res) => {
  try {
    const { items, customer } = req.body || {};
    if (!Array.isArray(items) || items.length < 1 || items.length > 30) return res.status(400).json({ error: "Carrinho inválido." });
    const name = String(customer?.name || "").trim().slice(0, 120);
    const email = String(customer?.email || "").trim().toLowerCase().slice(0, 180);
    if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: "Informe nome e e-mail válidos." });

    const normalized = [];
    for (const item of items) {
      const product = products.find(p => p.id === Number(item.id));
      const quantity = Number(item.quantity);
      if (!product || !Number.isInteger(quantity) || quantity < 1 || quantity > 20) return res.status(400).json({ error: "Produto ou quantidade inválidos." });
      normalized.push({ id: product.id, name: product.name, price: product.price, quantity, files: product.files });
    }
    const total = normalized.reduce((sum, p) => sum + p.price * p.quantity, 0);
    if (!Number.isSafeInteger(total) || total < 100) return res.status(400).json({ error: "O valor mínimo do pedido é R$ 1,00." });

    const id = crypto.randomUUID();
    const accessToken = crypto.randomBytes(32).toString("hex");
    await pool.query(
      "INSERT INTO orders (id, access_token, customer_name, customer_email, items, amount_cents) VALUES ($1,$2,$3,$4,$5,$6)",
      [id, accessToken, name, email, JSON.stringify(normalized), total]
    );

    const payload = {
      items: normalized.map(p => ({ quantity: p.quantity, price: p.price, description: p.name })),
      order_nsu: id,
      redirect_url: `${publicOrigin(req)}/pagamento-retorno?order=${encodeURIComponent(id)}&token=${encodeURIComponent(accessToken)}`,
      webhook_url: `${publicOrigin(req)}/api/webhooks/infinitepay`,
      customer: { name, email }
    };
    // API key is optional for basic checkout creation. If present, it is sent only server-side.
    const headers = { "Content-Type": "application/json" };
    if (API_KEY) headers["X-Api-Key"] = API_KEY;
    else payload.handle = HANDLE;

    const ipResponse = await fetch("https://api.checkout.infinitepay.io/links", {
      method: "POST", headers, body: JSON.stringify(payload)
    });
    const ipData = await ipResponse.json().catch(() => ({}));
    if (!ipResponse.ok || !ipData.url) {
      await pool.query("UPDATE orders SET status='checkout_error', updated_at=NOW() WHERE id=$1", [id]);
      return res.status(502).json({ error: "A InfinitePay não conseguiu criar o checkout. Confira se o Checkout Integrado está habilitado na sua conta." });
    }
    await pool.query("UPDATE orders SET checkout_url=$2, updated_at=NOW() WHERE id=$1", [id, ipData.url]);
    res.json({ checkout_url: ipData.url, order_id: id });
  } catch (error) {
    console.error("checkout_error", error);
    res.status(500).json({ error: "Erro interno ao iniciar o pagamento." });
  }
});

async function confirmPayment({ order_nsu, transaction_nsu, slug, receipt_url, capture_method }) {
  if (!order_nsu || !transaction_nsu || !slug) return false;
  const found = await pool.query("SELECT id,status FROM orders WHERE id=$1", [order_nsu]);
  if (!found.rowCount) return false;
  const headers = { "Content-Type": "application/json" };
  if (API_KEY) headers["X-Api-Key"] = API_KEY;
  const check = await fetch("https://api.checkout.infinitepay.io/payment_check", {
    method: "POST",
    headers,
    body: JSON.stringify({ handle: HANDLE, order_nsu, transaction_nsu, slug })
  });
  const result = await check.json().catch(() => ({}));
  if (!check.ok || result.success !== true || result.paid !== true) return false;
  await pool.query(
    `UPDATE orders SET status='paid', transaction_nsu=$2, invoice_slug=$3,
     capture_method=$4, receipt_url=$5, updated_at=NOW() WHERE id=$1`,
    [order_nsu, transaction_nsu, slug, capture_method || null, receipt_url || null]
  );
  return true;
}

app.post("/api/webhooks/infinitepay", async (req, res) => {
  try {
    const body = req.body || {};
    if (body.event === "refunded" || body.status === "refunded") {
      if (body.order_nsu) await pool.query("UPDATE orders SET status='refunded', updated_at=NOW() WHERE id=$1", [body.order_nsu]);
      return res.sendStatus(200);
    }
    const ok = await confirmPayment({
      order_nsu: body.order_nsu,
      transaction_nsu: body.transaction_nsu,
      slug: body.invoice_slug || body.slug,
      receipt_url: body.receipt_url,
      capture_method: body.capture_method
    });
    return res.sendStatus(ok ? 200 : 400);
  } catch (error) {
    console.error("webhook_error", error);
    return res.sendStatus(400);
  }
});


app.post("/api/confirm-return", async (req, res) => {
  try {
    const { order_id, token, transaction_nsu, slug, receipt_url, capture_method } = req.body || {};
    const owned = await pool.query("SELECT id FROM orders WHERE id=$1 AND access_token=$2", [order_id, token]);
    if (!owned.rowCount) return res.sendStatus(404);
    const paid = await confirmPayment({
      order_nsu: order_id, transaction_nsu, slug, receipt_url, capture_method
    });
    return res.json({ paid });
  } catch (error) {
    console.error("return_confirmation_error", error);
    return res.status(500).json({ error: "Não foi possível confirmar agora." });
  }
});

app.get("/api/orders/:id", async (req, res) => {
  const token = String(req.query.token || "");
  const result = await pool.query("SELECT id,status,items,amount_cents,customer_email FROM orders WHERE id=$1 AND access_token=$2", [req.params.id, token]);
  if (!result.rowCount) return res.sendStatus(404);
  const order = result.rows[0];
  const filesReady = order.status === "paid" && order.items.every(p => Array.isArray(p.files) && p.files.length > 0);
  res.json({ status: order.status, amount_cents: order.amount_cents, files_ready: filesReady, message: filesReady ? "Pagamento confirmado. Seus arquivos estão disponíveis." : order.status === "paid" ? "Pagamento confirmado. Os arquivos deste produto ainda precisam ser cadastrados pela loja." : "Aguardando confirmação do pagamento." });
});

app.get("/pagamento-retorno", (req, res) => {
  res.type("html").send(`<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Pedido | Artes & Vetores</title><body style="font:16px Arial;background:#101011;color:#f7f5ef;padding:40px;max-width:650px;margin:auto"><h1 style="color:#f0d58e">Estamos verificando seu pagamento</h1><p id="status">Aguarde enquanto confirmamos a transação com a InfinitePay. Não feche esta página.</p><a href="/" style="color:#f0d58e">Voltar à loja</a><script>
const p=new URLSearchParams(location.search), order=p.get("order"), token=p.get("token");
async function check(){if(!order||!token){document.getElementById("status").textContent="Não foi possível localizar o pedido.";return}
try{
 const tx=p.get("transaction_nsu"), slug=p.get("slug");
 if(tx && slug){await fetch("/api/confirm-return",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({order_id:order,token,transaction_nsu:tx,slug,receipt_url:p.get("receipt_url"),capture_method:p.get("capture_method")})});}
 const r=await fetch("/api/orders/"+encodeURIComponent(order)+"?token="+encodeURIComponent(token));const d=await r.json();document.getElementById("status").textContent=d.message+(d.status==="paid"?" Pedido confirmado.": " A confirmação pode levar alguns instantes; atualize esta página.");}
catch(e){document.getElementById("status").textContent="Não foi possível consultar agora. Tente novamente em instantes."}}
check();
</script></body></html>`);
});

app.get("/health", (_req, res) => res.json({ ok: true }));
initDb().then(() => app.listen(PORT, () => console.log(`Artes & Vetores server listening on ${PORT}`))).catch(err => { console.error(err); process.exit(1); });
