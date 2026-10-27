# Nexo Assist — instruções do projeto

Tier `client-demo`: desafio local com dados sintéticos. README é a referência de comportamento, execução e limites. Não descrever como produção pronta. Não incorporar dados, código, credenciais ou referências internas de empregadores.

TypeScript estrito. Fluxo de agente em LangGraph; interpretação separada de políticas e serviço simulado. Preservar autorização server-side, confirmação vinculada à prévia persistida, recibo idempotente e descarte de respostas após transferência ao analista.

Antes de concluir uma alteração: `npm run typecheck`, `npm test`, `npm run build`. Testes devem validar invariantes, não apenas repetir a implementação. Registrar limites de inferência real e revisão visual honestamente. Não inserir chaves em código, documentos ou bundle. Não publicar banco, `.env`, artefatos privados ou `node_modules`. Não criar CI ou deploy com cobrança implicitamente.

Login demonstrativo somente em loopback. O servidor recusa bind externo com esse login; não remover a restrição para facilitar deploy. Preferir testes locais e encerrar servidores iniciados ao terminar.
