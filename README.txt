ARTES & VETORES — INTEGRAÇÃO INFINITEPAY (BASE DE IMPLEMENTAÇÃO)

Conta / InfiniteTag configurada:
  leandroartefinalista
A InfiniteTag é pública. Não coloque a chave API no HTML, JavaScript do navegador, Git público ou mensagens.

O QUE ESTE PACOTE FAZ
- Mantém o visual da loja original.
- O botão de pagamento envia somente IDs e quantidades ao servidor.
- O servidor consulta seu catálogo próprio (data/products.json), calcula os preços em centavos e cria um checkout InfinitePay.
- O comprador é redirecionado para a página oficial da InfinitePay para pagar com os métodos disponíveis na conta.
- O webhook NÃO é considerado prova de pagamento: o servidor consulta /payment_check antes de marcar o pedido como pago.
- O pedido é guardado em PostgreSQL.

LIMITAÇÕES IMPORTANTES DESTA VERSÃO
- Isto é uma base de integração, não uma loja pronta para produção.
- O ZIP original só continha HTML/README. Não havia arquivos PNG/CDR/SVG/PDF reais para entregar.
- Os produtos de demonstração estão em data/products.json. Ajuste nomes, preços e IDs para seu catálogo real.
- Os arrays "files" estão vazios; a entrega automática de arquivos ainda não pode acontecer até que os arquivos sejam enviados e associados aos produtos.
- O painel administrativo antigo é apenas local e não deve ser usado em produção. Ele não altera o catálogo confiável do servidor.
- Falta configurar domínio HTTPS, PostgreSQL, hospedagem, política de privacidade, termos, dados de contato e processo operacional de suporte/estorno.
- A InfinitePay informa que não possui sandbox; qualquer teste de pagamento pode ser uma cobrança real. Teste somente com valor baixo e faça estorno pelo app se necessário.

PRÉ-REQUISITOS
- Node.js 20+
- PostgreSQL
- Hospedagem com HTTPS e URL pública estável

CONFIGURAÇÃO
1. No app InfinitePay: Vendas > Checkout > Configurações > habilite "Checkout Integrado".
2. Revogue a chave API que foi mostrada em uma captura de tela e gere uma nova, se for usar opções avançadas. A chave antiga deve ser tratada como comprometida.
3. Copie .env.example para .env.
4. Defina PUBLIC_BASE_URL com seu domínio HTTPS real.
5. Defina DATABASE_URL e DATABASE_SSL conforme seu provedor PostgreSQL.
6. INFINITEPAY_HANDLE já está definida como leandroartefinalista (sem $).
7. A API Key é opcional para criar checkout básico com a InfiniteTag. Se decidir usar uma chave nova, remova o # da linha INFINITEPAY_API_KEY e configure o valor somente no painel de variáveis secretas da hospedagem.
8. Instale dependências: npm install
9. Inicie: npm start
10. Publique o conteúdo em uma hospedagem Node.js e configure o domínio HTTPS.

CATÁLOGO E ARQUIVOS
- Edite data/products.json no servidor.
- price deve ser inteiro em centavos: R$ 19,90 = 1990.
- Antes de vender um produto digital, associe arquivos reais a ele e implemente armazenamento privado/links temporários. Não coloque os arquivos pagos em pasta pública.
- Não anuncie entrega automática enquanto os arquivos reais não estiverem cadastrados e testados.

SEGURANÇA / PAGAMENTO
- A InfinitePay documenta POST https://api.checkout.infinitepay.io/links e POST https://api.checkout.infinitepay.io/payment_check.
- A chave API, se usada, é enviada somente pelo servidor no header X-Api-Key.
- A documentação informa que webhooks não têm assinatura. Por isso, o servidor confirma cada pagamento pelo endpoint payment_check antes de marcar o pedido como pago.
- A URL de retorno do navegador não confirma pagamento por si só.
- Reembolsos e cancelamentos precisam ser tratados no painel/app InfinitePay e refletidos no sistema.
- Não armazene número de cartão, CVV ou senha bancária.

DOCUMENTAÇÃO OFICIAL
https://www.infinitepay.io/checkout-documentacao
https://ajuda.infinitepay.io/pt-BR/articles/10766888-como-usar-o-checkout-integrado-da-infinitepay

ANTES DE COLOCAR NO AR
Peça a um desenvolvedor para revisar configuração, autenticação administrativa, proteção contra abuso, backups, armazenamento privado dos downloads, LGPD, termos de compra e testes ponta a ponta. Não compartilhe sua chave API.
