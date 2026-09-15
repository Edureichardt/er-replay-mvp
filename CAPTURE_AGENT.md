# ER Capture Agent (beta)

O frontend e a API continuam online. O Agent roda no computador da arena porque endereços como `192.168.x.x` não são acessíveis pelo Render.

## Preparação
1. Instale Node.js e FFmpeg no PC da arena. Confirme `ffmpeg -version`.
2. Na raiz do projeto rode `npm install`.
3. Copie `apps/agent/.env.example` para `apps/agent/.env`.
4. Configure `API_URL`, `ADMIN_EMAIL` e `ADMIN_PASSWORD` com a conta ADMIN daquele cliente. Não use a conta developer.

## Rodar
`npm run dev:agent`

O Agent autentica na API, baixa somente as quadras/câmeras pertencentes ao ADMIN, inicia o buffer local da câmera ativa e consulta pedidos de replay. Ao receber um pedido, gera o MP4 localmente, envia para a API e a API publica no Cloudinary.

## RTSP com @ na senha
Cadastre a senha normal no painel (por exemplo, começando com `@`). O sistema faz `encodeURIComponent` ao montar a URL, portanto não digite `%40` no campo senha.

## Deploy da atualização
API/Render: faça commit/push; o Render recompila a API.
Web/Vercel: o mesmo push dispara o novo build do frontend.
Agent: permanece no PC da arena e deve ficar aberto durante o uso.

## Limitação beta
A fila de pedidos de replay está em memória na API. Se o Render reiniciar exatamente durante um pedido, aquele pedido falha e pode ser solicitado novamente. Para produção, mover a fila para Neon/Redis.
