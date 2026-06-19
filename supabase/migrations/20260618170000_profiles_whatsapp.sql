-- InfraWork — contato de WhatsApp no cadastro de usuários
--
-- Fundação para o RAG do módulo WhatsApp: além da sessão (número do bot), cada
-- usuário pode ter o próprio número de WhatsApp registrado. Mais tarde isso casa
-- o JID do remetente (ex.: 5564999998888@s.whatsapp.net) com o profile do autor.
--
-- Guardamos só dígitos em formato internacional (DDI+DDD+número), sem símbolos —
-- o front normaliza ao salvar. Coluna opcional (nem todo usuário tem WhatsApp).

alter table public.profiles
  add column if not exists whatsapp text;

comment on column public.profiles.whatsapp is
  'Número de WhatsApp do usuário (dígitos, formato internacional). Usado pelo RAG do módulo WhatsApp para casar remetente↔usuário.';
