create extension if not exists pgcrypto;

do $$ begin
  create type public.message_role as enum ('system', 'user', 'assistant', 'tool');
exception
  when duplicate_object then null;
end $$;

do $$ begin
  create type public.run_status as enum ('success', 'failed');
exception
  when duplicate_object then null;
end $$;

create table if not exists public.users (
  id uuid primary key default gen_random_uuid(),
  external_user_id text unique,
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.chat_sessions (
  id uuid primary key,
  user_id uuid references public.users(id) on delete set null,
  title text,
  started_at timestamptz not null default now(),
  last_activity_at timestamptz not null default now(),
  status text not null default 'active',
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists idx_chat_sessions_user_id on public.chat_sessions(user_id);
create index if not exists idx_chat_sessions_last_activity on public.chat_sessions(last_activity_at desc);

create table if not exists public.chat_messages (
  id bigint generated always as identity primary key,
  session_id uuid not null references public.chat_sessions(id) on delete cascade,
  role public.message_role not null,
  content text not null,
  tool_call_id text,
  tool_name text,
  token_count int,
  created_at timestamptz not null default now()
);

create index if not exists idx_chat_messages_session_created on public.chat_messages(session_id, created_at);
create index if not exists idx_chat_messages_role on public.chat_messages(role);

create table if not exists public.llm_requests (
  id bigint generated always as identity primary key,
  session_id uuid not null references public.chat_sessions(id) on delete cascade,
  provider text not null default 'openrouter',
  model text not null,
  input_message_count int not null default 0,
  prompt_tokens int,
  completion_tokens int,
  total_tokens int,
  latency_ms int,
  status public.run_status not null,
  error_message text,
  created_at timestamptz not null default now()
);

create index if not exists idx_llm_requests_session_created on public.llm_requests(session_id, created_at desc);
create index if not exists idx_llm_requests_status on public.llm_requests(status);

create table if not exists public.tool_calls (
  id bigint generated always as identity primary key,
  session_id uuid not null references public.chat_sessions(id) on delete cascade,
  llm_request_id bigint references public.llm_requests(id) on delete set null,
  message_id bigint references public.chat_messages(id) on delete set null,
  tool_name text not null,
  arguments_json jsonb not null default '{}'::jsonb,
  result_json jsonb,
  error_message text,
  status public.run_status not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_tool_calls_session_created on public.tool_calls(session_id, created_at desc);
create index if not exists idx_tool_calls_tool_name on public.tool_calls(tool_name);

create table if not exists public.hotels (
  id bigint generated always as identity primary key,
  source text not null default 'serpapi',
  source_hotel_id text not null,
  name text not null,
  location text not null,
  price numeric,
  currency text not null default 'IDR',
  rating numeric,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source, source_hotel_id)
);

create index if not exists idx_hotels_location on public.hotels(location);
create index if not exists idx_hotels_name on public.hotels(name);
create index if not exists idx_hotels_rating on public.hotels(rating desc);

create table if not exists public.hotel_recommendations (
  id bigint generated always as identity primary key,
  session_id uuid not null references public.chat_sessions(id) on delete cascade,
  message_id bigint references public.chat_messages(id) on delete set null,
  hotel_id bigint not null references public.hotels(id) on delete cascade,
  reason text,
  rank int,
  created_at timestamptz not null default now()
);

create index if not exists idx_hotel_reco_session_created on public.hotel_recommendations(session_id, created_at desc);
create index if not exists idx_hotel_reco_hotel_id on public.hotel_recommendations(hotel_id);

create table if not exists public.session_saved_hotels (
  id bigint generated always as identity primary key,
  session_id uuid not null references public.chat_sessions(id) on delete cascade,
  hotel_id bigint not null references public.hotels(id) on delete cascade,
  saved_by text not null default 'assistant',
  snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_session_saved_hotels_session_created on public.session_saved_hotels(session_id, created_at desc);

alter table public.users enable row level security;
alter table public.chat_sessions enable row level security;
alter table public.chat_messages enable row level security;
alter table public.llm_requests enable row level security;
alter table public.tool_calls enable row level security;
alter table public.hotels enable row level security;
alter table public.hotel_recommendations enable row level security;
alter table public.session_saved_hotels enable row level security;

do $$ begin
  create policy "Allow anon manage users" on public.users for all to anon using (true) with check (true);
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "Allow anon read hotels" on public.hotels for select to anon using (true);
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "Allow anon insert hotels" on public.hotels for insert to anon with check (true);
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "Allow anon update hotels" on public.hotels for update to anon using (true) with check (true);
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "Allow anon manage chat sessions" on public.chat_sessions for all to anon using (true) with check (true);
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "Allow anon manage chat messages" on public.chat_messages for all to anon using (true) with check (true);
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "Allow anon manage llm requests" on public.llm_requests for all to anon using (true) with check (true);
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "Allow anon manage tool calls" on public.tool_calls for all to anon using (true) with check (true);
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "Allow anon manage hotel recommendations" on public.hotel_recommendations for all to anon using (true) with check (true);
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "Allow anon manage session saved hotels" on public.session_saved_hotels for all to anon using (true) with check (true);
exception when duplicate_object then null; end $$;