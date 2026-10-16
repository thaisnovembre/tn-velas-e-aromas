# TN Velas e Aromas — Loja virtual

Projeto inicial de loja virtual com:
- Vitrine responsiva e catálogo por categorias.
- Busca e filtro de produtos.
- Carrinho de compras salvo no navegador.
- Finalização via WhatsApp com mensagem detalhada.
- Painel administrativo protegido por login.
- Cadastro, edição, ativação, estoque, preço promocional e upload de fotos.
- Configurações de WhatsApp, Instagram, entrega, retirada e pagamento.
- Histórico de pedidos registrados no banco de dados SQLite.

## Requisitos
- Node.js 20 ou superior.
- npm.

## Instalação local
1. Extraia o ZIP.
2. Abra um terminal dentro da pasta do projeto.
3. Execute `npm install`.
4. Copie `.env.example` para `.env`.
5. Edite `.env` e configure `SESSION_SECRET`, `ADMIN_USER` e `ADMIN_PASSWORD`.
6. Execute `npm start`.
7. Acesse `http://localhost:3000`.

## Primeiro acesso
- Painel: `http://localhost:3000/admin`
- Usuário e senha: os valores definidos no arquivo `.env`.
- Configure o WhatsApp comercial na aba Configurações.
- Cadastre seus produtos e substitua os exemplos pelas fotos e preços reais.

## Pedidos pelo WhatsApp
O sistema salva o pedido no banco de dados antes de abrir o WhatsApp com a mensagem pronta. O cliente ainda precisa tocar em **Enviar** no WhatsApp para encaminhar a mensagem. Não há cobrança automática nesta versão.

## Importante antes de publicar
- Troque a senha administrativa e o segredo de sessão.
- Use hospedagem que suporte Node.js e armazenamento persistente.
- Configure HTTPS e faça backup periódico da pasta `data/` e `uploads/`.
- O banco SQLite precisa ficar em disco persistente; ambientes efêmeros podem apagar os dados após reinicialização.
- Teste o cadastro, o estoque e o WhatsApp em celular e computador.
- Os produtos de demonstração têm preços ilustrativos: edite ou remova antes de divulgar a loja.
- Esta versão é um ponto de partida funcional, não substitui uma revisão de segurança e testes antes de receber pedidos reais.

## Estrutura
- `server.js`: API, banco de dados, autenticação e servidor web.
- `public/index.html`: loja.
- `public/admin.html`: painel administrativo.
- `public/styles.css`: estilos.
- `public/store.js`: vitrine e carrinho.
- `public/admin.js`: painel administrativo.
- `data/`: banco de dados criado automaticamente.
- `uploads/`: imagens enviadas pelo administrador.
