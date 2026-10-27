import type { Article } from "../shared/domain.js";
import { normalize } from "./policy.js";
export const articles: Article[] = [
  {
    id: "KB-101",
    title: "VPN: erro 809 no Windows 10",
    tags: ["vpn", "809"],
    os: "Windows 10",
    body: "No Windows 10, reinstale o cliente de VPN pelo portal corporativo de softwares e reinicie o computador. Se persistir, abra um chamado. Este procedimento não se aplica ao Windows 11; nesse sistema, o suporte precisa investigar.",
  },
  {
    id: "KB-102",
    title: "Horário e canais do service desk",
    tags: ["horario", "expediente", "plantao"],
    body: "O service desk atende de segunda a sexta, das 8h às 18h (Brasília). Incidentes críticos têm plantão 24 horas. Você também pode solicitar um analista por este chat.",
  },
  {
    id: "KB-103",
    title: "Recuperar senha corporativa",
    tags: ["senha", "reset", "redefinir"],
    body: "Para recuperar a senha corporativa, abra a opção “Esqueci minha senha” no portal de identidade da empresa e valide seu segundo fator. Não compartilhe sua senha nem códigos de verificação no chat. Se a conta continuar bloqueada, solicite atendimento.",
  },
  {
    id: "KB-104",
    title: "Solicitar segundo monitor",
    tags: ["monitor", "equipamento"],
    body: "Um segundo monitor é uma requisição de Hardware. Informe a justificativa, quem utilizará e se há prazo. A compra depende de aprovação; o assistente não garante aprovação nem entrega.",
  },
  {
    id: "KB-105",
    title: "Aplicativo corporativo indisponível",
    tags: ["aplicativo", "software", "instalar"],
    body: "Verifique se o aplicativo aparece no portal corporativo de softwares. Não instale executáveis de fontes desconhecidas. Se estiver ausente, solicite uma requisição com nome, finalidade e usuários afetados.",
  },
  {
    id: "KB-106",
    title: "Outlook não sincroniza",
    tags: ["outlook", "sincroniza", "e-mail", "email"],
    body: "Confirme sua conexão de rede e se o e-mail funciona no navegador. Se funcionar pela web, use essa alternativa temporária e informe o erro do aplicativo ao suporte. Não envie mensagens ou anexos confidenciais neste chat.",
  },
  {
    id: "KB-107",
    title: "Impressora sem conexão",
    tags: ["impressora", "imprimir"],
    body: "Confirme se a impressora está ligada e conectada à rede corporativa. Informe o nome da impressora e a mensagem de erro. Se outros usuários também não conseguem imprimir, descreva o impacto para o suporte.",
  },
  {
    id: "KB-108",
    title: "Bloqueio de acesso ao SAP",
    tags: ["sap", "bloquead"],
    body: "Se o acesso ao SAP estiver bloqueado, informe a mensagem exibida e desde quando ocorre. O suporte verifica a autorização e o bloqueio. Nunca informe senha ou token. Não tente usar credenciais de outra pessoa.",
  },
];
export function searchArticles(query: string): Article[] {
  const q = normalize(query);
  return articles
    .map((article) => ({
      article,
      score: article.tags.filter((t) => q.includes(normalize(t))).length,
    }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map((x) => x.article);
}
