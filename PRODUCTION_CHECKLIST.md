# Verificação da demonstração

Tier: `client-demo`. Decisão: **aprovado para avaliação local com ressalvas; não aprovado para produção ou deploy público**.

- [x] TypeScript estrito e build concluídos.
- [x] 23 testes automatizados de domínio, API, persistência e adaptador de modelo passaram.
- [x] Dados fictícios e modo demonstração identificados na interface.
- [x] Acesso por titular e papel verificados no servidor e em testes.
- [x] Confirmação, idempotência e falhas após gravação verificadas.
- [x] Estado humano/histórico persistem após reabrir o banco em teste.
- [x] `.env.example`, `.gitignore` e instruções locais presentes.
- [x] Revisão visual e fluxos principais no Chrome desktop (login, prévia, confirmação, transferência, assumir, responder e devolver).
- [ ] Responsividade móvel e acessibilidade completa.
- [ ] Inferência em provedor externo com chave real e avaliação de qualidade.
- [ ] Testes ponta a ponta da interface e acessibilidade.
- [ ] SSO e autenticação adequada para produção.
- [ ] Deploy, retenção, backups e operação de produção.

Não há um lint separado ou CI configurado. As pendências não devem ser marcadas como realizadas por existir código correspondente.
