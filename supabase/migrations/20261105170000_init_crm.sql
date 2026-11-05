-- Мини-CRM: объекты, задачи, история статусов.
-- Права проверяет сама база. Роли anon и authenticated не владеют таблицами
-- и не могут обойти правила прямым запросом через API.
--
-- Статус меняется только если в этой же транзакции выставлена app.transition.
-- Это делает функция public.transition_task. Через REST произвольный SQL
-- и произвольные настройки сессии отправить нельзя.
-- Историю пишет триггер. Вставить, изменить или удалить её запросом с сайта нельзя.

create schema if not exists private;

revoke all on schema private from public;
revoke all on schema private from anon, authenticated;

do $$
begin
  create type public.user_role as enum ('assigner', 'executor');
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type public.task_status as enum (
    'new',
    'in_progress',
    'in_review',
    'accepted',
    'rework'
  );
exception
  when duplicate_object then null;
end $$;

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null unique,
  full_name text not null,
  role public.user_role not null,
  created_at timestamptz not null default now(),
  constraint profiles_name_not_blank check (char_length(trim(full_name)) between 1 and 120),
  constraint profiles_email_not_blank check (char_length(trim(email)) between 3 and 320)
);

create table if not exists public.objects (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  address text not null,
  created_by uuid not null references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint objects_name_not_blank check (char_length(trim(name)) between 1 and 200),
  constraint objects_address_not_blank check (char_length(trim(address)) between 1 and 500)
);

create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text not null default '',
  object_id uuid not null references public.objects (id) on delete cascade,
  assignee_id uuid not null references public.profiles (id) on delete restrict,
  status public.task_status not null default 'new',
  author_id uuid not null references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tasks_title_not_blank check (char_length(trim(title)) between 1 and 200),
  constraint tasks_description_len check (char_length(description) <= 5000)
);

create table if not exists public.task_status_history (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks (id) on delete cascade,
  changed_by uuid not null references public.profiles (id) on delete restrict,
  from_status public.task_status,
  to_status public.task_status not null,
  comment text,
  created_at timestamptz not null default now(),
  constraint history_comment_len check (comment is null or char_length(comment) <= 2000),
  constraint history_transition_valid check (
    (from_status is null and to_status = 'new')
    or (from_status = 'new' and to_status = 'in_progress')
    or (from_status = 'in_progress' and to_status = 'in_review')
    or (from_status = 'in_review' and to_status = 'accepted')
    or (from_status = 'in_review' and to_status = 'rework')
    or (from_status = 'rework' and to_status = 'in_progress')
  ),
  constraint history_rework_has_comment check (
    not (from_status = 'in_review' and to_status = 'rework')
    or (comment is not null and char_length(trim(comment)) > 0)
  )
);

create index if not exists tasks_object_id_idx on public.tasks (object_id);
create index if not exists tasks_assignee_id_idx on public.tasks (assignee_id);
create index if not exists tasks_status_idx on public.tasks (status);
create index if not exists history_task_id_idx on public.task_status_history (task_id, created_at);

-- Текущий пользователь — постановщик. Читает profiles в обход RLS,
-- иначе политика profiles и эта функция зациклятся.
create or replace function public.is_assigner()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select role = 'assigner' from public.profiles where id = auth.uid()),
    false
  );
$$;

-- Кого исполнитель имеет право видеть: себя, автора своей задачи
-- и тех, кто отмечен в истории его задач. Постановщик видит всех.
create or replace function public.can_read_profile(target uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    auth.uid() is not null
    and (
      target = auth.uid()
      or exists (
        select 1 from public.profiles p
        where p.id = auth.uid() and p.role = 'assigner'
      )
      or exists (
        select 1 from public.tasks t
        where t.assignee_id = auth.uid()
          and (t.author_id = target or t.assignee_id = target)
      )
      or exists (
        select 1
        from public.task_status_history h
        join public.tasks t on t.id = h.task_id
        where t.assignee_id = auth.uid()
          and h.changed_by = target
      )
    );
$$;

revoke all on function public.is_assigner() from public, anon, authenticated;
revoke all on function public.can_read_profile(uuid) from public, anon, authenticated;
grant execute on function public.is_assigner() to authenticated;
grant execute on function public.can_read_profile(uuid) to authenticated;

create or replace function private.enforce_object_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    if auth.uid() is not null and not public.is_assigner() then
      raise exception 'FORBIDDEN';
    end if;
    return old;
  end if;

  if tg_op = 'INSERT' then
    if auth.uid() is not null then
      if not public.is_assigner() then
        raise exception 'ONLY_ASSIGNER';
      end if;
      new.created_by := auth.uid();
      new.created_at := now();
    else
      if new.created_by is null or not exists (
        select 1 from public.profiles p
        where p.id = new.created_by and p.role = 'assigner'
      ) then
        raise exception 'ONLY_ASSIGNER';
      end if;
      new.created_at := coalesce(new.created_at, now());
    end if;

    new.updated_at := now();
    return new;
  end if;

  if auth.uid() is not null and not public.is_assigner() then
    raise exception 'FORBIDDEN';
  end if;

  new.id := old.id;
  new.created_by := old.created_by;
  new.created_at := old.created_at;
  new.updated_at := now();
  return new;
end;
$$;

create or replace function private.enforce_task_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  resolved_actor uuid;
  actor_role public.user_role;
  comment_text text;
begin
  if tg_op = 'DELETE' then
    if auth.uid() is not null and not public.is_assigner() then
      raise exception 'FORBIDDEN';
    end if;
    -- История удаляется только вместе с задачей и только из этого триггера.
    perform set_config('app.deleting_task', '1', true);
    delete from public.task_status_history where task_id = old.id;
    return old;
  end if;

  if tg_op = 'INSERT' then
    if auth.uid() is not null then
      if not public.is_assigner() then
        raise exception 'ONLY_ASSIGNER';
      end if;
      new.author_id := auth.uid();
      new.status := 'new';
      new.created_at := now();
    else
      if new.author_id is null or new.status is distinct from 'new' then
        raise exception 'FORBIDDEN_TRANSITION';
      end if;
      if not exists (
        select 1 from public.profiles p
        where p.id = new.author_id and p.role = 'assigner'
      ) then
        raise exception 'ONLY_ASSIGNER';
      end if;
      new.created_at := coalesce(new.created_at, now());
    end if;

    if not exists (
      select 1 from public.profiles p
      where p.id = new.assignee_id and p.role = 'executor'
    ) then
      raise exception 'ASSIGNEE_MUST_BE_EXECUTOR';
    end if;

    new.updated_at := now();
    return new;
  end if;

  new.id := old.id;
  new.author_id := old.author_id;
  new.created_at := old.created_at;

  if new.title is distinct from old.title
    or new.description is distinct from old.description
    or new.object_id is distinct from old.object_id
    or new.assignee_id is distinct from old.assignee_id then
    if auth.uid() is not null and not public.is_assigner() then
      raise exception 'FORBIDDEN';
    end if;
  end if;

  if new.assignee_id is distinct from old.assignee_id and not exists (
    select 1 from public.profiles p
    where p.id = new.assignee_id and p.role = 'executor'
  ) then
    raise exception 'ASSIGNEE_MUST_BE_EXECUTOR';
  end if;

  if new.status is distinct from old.status then
    if current_setting('app.transition', true) is distinct from '1' then
      raise exception 'FORBIDDEN_TRANSITION';
    end if;

    resolved_actor := auth.uid();
    if resolved_actor is null then
      begin
        resolved_actor := nullif(current_setting('app.transition_actor', true), '')::uuid;
      exception
        when invalid_text_representation then
          resolved_actor := null;
      end;
    end if;

    if resolved_actor is null then
      raise exception 'NOT_AUTHENTICATED';
    end if;

    if not (
      (old.status = 'new' and new.status = 'in_progress')
      or (old.status = 'in_progress' and new.status = 'in_review')
      or (old.status = 'in_review' and new.status = 'accepted')
      or (old.status = 'in_review' and new.status = 'rework')
      or (old.status = 'rework' and new.status = 'in_progress')
    ) then
      raise exception 'FORBIDDEN_TRANSITION';
    end if;

    if (
      (old.status = 'new' and new.status = 'in_progress')
      or (old.status = 'rework' and new.status = 'in_progress')
      or (old.status = 'in_progress' and new.status = 'in_review')
    ) and resolved_actor is distinct from old.assignee_id then
      raise exception 'FORBIDDEN';
    end if;

    if old.status = 'in_review' and new.status in ('accepted', 'rework') then
      select p.role into actor_role
      from public.profiles p
      where p.id = resolved_actor;

      if actor_role is distinct from 'assigner' then
        raise exception 'FORBIDDEN';
      end if;
    end if;

    comment_text := nullif(trim(coalesce(current_setting('app.transition_comment', true), '')), '');
    if char_length(coalesce(comment_text, '')) > 2000 then
      raise exception 'COMMENT_TOO_LONG';
    end if;

    if old.status = 'in_review' and new.status = 'rework' and comment_text is null then
      raise exception 'COMMENT_REQUIRED';
    end if;
  end if;

  new.updated_at := now();
  return new;
end;
$$;

create or replace function private.write_task_history()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  actor uuid;
  comment_text text;
  at_time timestamptz;
begin
  if tg_op = 'INSERT' then
    perform set_config('app.history_write', '1', true);
    insert into public.task_status_history (
      task_id, changed_by, from_status, to_status, comment, created_at
    ) values (
      new.id, new.author_id, null, 'new', null, new.created_at
    );
    perform set_config('app.history_write', '', true);
    return new;
  end if;

  if new.status is not distinct from old.status then
    return new;
  end if;

  actor := auth.uid();
  if actor is null then
    begin
      actor := nullif(current_setting('app.transition_actor', true), '')::uuid;
    exception
      when invalid_text_representation then
        actor := null;
    end;
  end if;

  if actor is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  comment_text := nullif(trim(coalesce(current_setting('app.transition_comment', true), '')), '');

  begin
    if nullif(current_setting('app.transition_at', true), '') is not null then
      at_time := nullif(current_setting('app.transition_at', true), '')::timestamptz;
    end if;
  exception
    when others then
      at_time := null;
  end;

  perform set_config('app.history_write', '1', true);
  insert into public.task_status_history (
    task_id, changed_by, from_status, to_status, comment, created_at
  ) values (
    new.id,
    actor,
    old.status,
    new.status,
    comment_text,
    coalesce(at_time, now())
  );
  perform set_config('app.history_write', '', true);
  return new;
end;
$$;

create or replace function private.guard_history()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' and current_setting('app.history_write', true) = '1' then
    return new;
  end if;

  if tg_op = 'DELETE' and current_setting('app.deleting_task', true) = '1' then
    return old;
  end if;

  raise exception 'HISTORY_IMMUTABLE';
end;
$$;

drop trigger if exists objects_enforce_write on public.objects;
create trigger objects_enforce_write
  before insert or update or delete on public.objects
  for each row execute function private.enforce_object_write();

drop trigger if exists tasks_enforce_write on public.tasks;
create trigger tasks_enforce_write
  before insert or update or delete on public.tasks
  for each row execute function private.enforce_task_write();

drop trigger if exists tasks_write_history on public.tasks;
create trigger tasks_write_history
  after insert or update on public.tasks
  for each row execute function private.write_task_history();

drop trigger if exists history_guard on public.task_status_history;
create trigger history_guard
  before insert or update or delete on public.task_status_history
  for each row execute function private.guard_history();

alter table public.profiles enable row level security;
alter table public.objects enable row level security;
alter table public.tasks enable row level security;
alter table public.task_status_history enable row level security;

drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select to authenticated
  using (public.can_read_profile(id));

drop policy if exists objects_select on public.objects;
create policy objects_select on public.objects
  for select to authenticated
  using (
    public.is_assigner()
    or exists (
      select 1 from public.tasks t
      where t.object_id = objects.id
        and t.assignee_id = auth.uid()
    )
  );

drop policy if exists objects_insert on public.objects;
create policy objects_insert on public.objects
  for insert to authenticated
  with check (public.is_assigner() and created_by = auth.uid());

drop policy if exists objects_update on public.objects;
create policy objects_update on public.objects
  for update to authenticated
  using (public.is_assigner())
  with check (public.is_assigner());

drop policy if exists objects_delete on public.objects;
create policy objects_delete on public.objects
  for delete to authenticated
  using (public.is_assigner());

drop policy if exists tasks_select on public.tasks;
create policy tasks_select on public.tasks
  for select to authenticated
  using (public.is_assigner() or assignee_id = auth.uid());

drop policy if exists tasks_insert on public.tasks;
create policy tasks_insert on public.tasks
  for insert to authenticated
  with check (
    public.is_assigner()
    and author_id = auth.uid()
    and status = 'new'
  );

drop policy if exists tasks_update on public.tasks;
create policy tasks_update on public.tasks
  for update to authenticated
  using (public.is_assigner())
  with check (public.is_assigner());

drop policy if exists tasks_delete on public.tasks;
create policy tasks_delete on public.tasks
  for delete to authenticated
  using (public.is_assigner());

drop policy if exists history_select on public.task_status_history;
create policy history_select on public.task_status_history
  for select to authenticated
  using (
    public.is_assigner()
    or exists (
      select 1 from public.tasks t
      where t.id = task_status_history.task_id
        and t.assignee_id = auth.uid()
    )
  );

revoke all on public.profiles from anon, authenticated;
revoke all on public.objects from anon, authenticated;
revoke all on public.tasks from anon, authenticated;
revoke all on public.task_status_history from anon, authenticated;

grant select on public.profiles to authenticated;
grant select, insert, update, delete on public.objects to authenticated;
grant select, insert, delete on public.tasks to authenticated;
grant update (title, description, object_id, assignee_id) on public.tasks to authenticated;
grant select on public.task_status_history to authenticated;

-- Единственный способ сменить статус из приложения.
-- Функция работает от владельца таблицы, поэтому сама проверяет,
-- кто вызывает и видит ли он задачу. RLS её не останавливает — проверки внутри.
create or replace function public.transition_task(
  p_task_id uuid,
  p_to_status public.task_status,
  p_comment text default null
)
returns public.tasks
language plpgsql
security definer
set search_path = public
as $$
declare
  result public.tasks;
  current_status public.task_status;
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  select t.status into current_status
  from public.tasks t
  where t.id = p_task_id
    and (public.is_assigner() or t.assignee_id = auth.uid());

  if current_status is null then
    raise exception 'TASK_NOT_FOUND';
  end if;

  if current_status = p_to_status then
    raise exception 'FORBIDDEN_TRANSITION';
  end if;

  -- Сбрасываем поля, которыми мог бы воспользоваться только локальный SQL.
  -- Для вызова из API актёром всегда остаётся вошедший пользователь.
  perform set_config('app.transition', '1', true);
  perform set_config('app.transition_comment', coalesce(p_comment, ''), true);
  perform set_config('app.transition_actor', '', true);
  perform set_config('app.transition_at', '', true);

  update public.tasks
  set status = p_to_status
  where id = p_task_id
  returning * into result;

  return result;
end;
$$;

revoke all on function public.transition_task(uuid, public.task_status, text) from public, anon, authenticated;
grant execute on function public.transition_task(uuid, public.task_status, text) to authenticated;

-- Роль берётся только из app_metadata. Её нельзя задать при самостоятельной регистрации:
-- user_metadata пользователь может прислать сам, app_metadata — нет.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  assigned_role public.user_role := 'executor';
  meta_role text := coalesce(new.raw_app_meta_data ->> 'role', '');
  full_name text;
begin
  if meta_role in ('assigner', 'executor') then
    assigned_role := meta_role::public.user_role;
  end if;

  full_name := nullif(trim(coalesce(new.raw_user_meta_data ->> 'full_name', '')), '');
  if full_name is null then
    full_name := split_part(coalesce(new.email, 'user'), '@', 1);
  end if;

  insert into public.profiles (id, email, full_name, role)
  values (new.id, coalesce(new.email, ''), full_name, assigned_role)
  on conflict (id) do nothing;

  return new;
end;
$$;

revoke all on function public.handle_new_user() from public, anon, authenticated;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Служебный переход для начальных данных. Схема private в API не опубликована,
-- execute у anon/authenticated отозван.
create or replace function private.apply_status(
  p_actor uuid,
  p_task_id uuid,
  p_to_status public.task_status,
  p_comment text,
  p_at timestamptz
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform set_config('app.transition', '1', true);
  perform set_config('app.transition_comment', coalesce(p_comment, ''), true);
  perform set_config('app.transition_actor', p_actor::text, true);
  perform set_config('app.transition_at', p_at::text, true);

  update public.tasks
  set status = p_to_status
  where id = p_task_id;

  if not found then
    raise exception 'TASK_NOT_FOUND';
  end if;
end;
$$;

revoke all on function private.apply_status(uuid, uuid, public.task_status, text, timestamptz) from public, anon, authenticated;

create or replace function private.seed_demo()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  anna uuid;
  ivan uuid;
  maria uuid;
  northern uuid;
  school uuid;
  warehouse uuid;
  concrete uuid;
  rebar uuid;
  fence uuid;
  roof uuid;
  act uuid;
  windows uuid;
begin
  select id into anna from public.profiles where email = 'anna.petrova@crm.test';
  select id into ivan from public.profiles where email = 'ivan.sorokin@crm.test';
  select id into maria from public.profiles where email = 'maria.lebedeva@crm.test';

  if anna is null or ivan is null or maria is null then
    raise exception 'SEED_USERS_MISSING';
  end if;

  delete from public.objects
  where name in ('ЖК «Северный»', 'Школа № 4', 'Склад на Индустриальной');

  insert into public.objects (name, address, created_by, created_at)
  values ('ЖК «Северный»', 'ул. Лесная, 12', anna, now() - interval '14 days')
  returning id into northern;

  insert into public.objects (name, address, created_by, created_at)
  values ('Школа № 4', 'проспект Строителей, 7', anna, now() - interval '20 days')
  returning id into school;

  insert into public.objects (name, address, created_by, created_at)
  values ('Склад на Индустриальной', 'Индустриальная ул., 3', anna, now() - interval '4 days')
  returning id into warehouse;

  insert into public.tasks (title, description, object_id, assignee_id, author_id, status, created_at)
  values (
    'Согласовать поставку бетона',
    'Согласовать марку и дату подачи бетона на фундаментную плиту секции 2.',
    northern, ivan, anna, 'new', now() - interval '2 days'
  )
  returning id into concrete;

  insert into public.tasks (title, description, object_id, assignee_id, author_id, status, created_at)
  values (
    'Проверить армирование перекрытия',
    'Принять каркас перекрытия на отметке +3.300 до заливки.',
    northern, ivan, anna, 'new', now() - interval '6 days'
  )
  returning id into rebar;

  insert into public.tasks (title, description, object_id, assignee_id, author_id, status, created_at)
  values (
    'Смонтировать ограждение котлована',
    'Поставить инвентарное ограждение по контуру котлована и проверить проходы.',
    northern, maria, anna, 'new', now() - interval '3 days'
  )
  returning id into fence;

  insert into public.tasks (title, description, object_id, assignee_id, author_id, status, created_at)
  values (
    'Устранить замечания по кровле',
    'Закрыть замечания технадзора по ендове и примыканиям.',
    school, maria, anna, 'new', now() - interval '10 days'
  )
  returning id into roof;

  insert into public.tasks (title, description, object_id, assignee_id, author_id, status, created_at)
  values (
    'Сдать акт скрытых работ',
    'Оформить акт на гидроизоляцию фундамента и передать схему.',
    school, ivan, anna, 'new', now() - interval '12 days'
  )
  returning id into act;

  insert into public.tasks (title, description, object_id, assignee_id, author_id, status, created_at)
  values (
    'Заказать оконные блоки',
    'Снять размеры проёмов склада и отправить заявку поставщику.',
    warehouse, maria, anna, 'new', now() - interval '1 day'
  )
  returning id into windows;

  perform private.apply_status(ivan, rebar, 'in_progress', null, now() - interval '5 days');
  perform private.apply_status(ivan, rebar, 'in_review', 'Каркас собран, можно смотреть.', now() - interval '4 days');

  perform private.apply_status(maria, fence, 'in_progress', null, now() - interval '2 days');

  perform private.apply_status(maria, roof, 'in_progress', null, now() - interval '9 days');
  perform private.apply_status(maria, roof, 'in_review', 'Кровля закрыта, прошу принять.', now() - interval '7 days');
  perform private.apply_status(
    anna,
    roof,
    'rework',
    'Провис ендовы на осях 3–4, нужно переделать до конца недели.',
    now() - interval '6 days'
  );

  perform private.apply_status(ivan, act, 'in_progress', null, now() - interval '11 days');
  perform private.apply_status(ivan, act, 'in_review', 'Акт и схема у прораба на объекте.', now() - interval '8 days');
  perform private.apply_status(anna, act, 'accepted', 'Акт принят.', now() - interval '7 days');
end;
$$;

revoke all on function private.seed_demo() from public, anon, authenticated;

create table if not exists private.schema_migrations (
  version text primary key,
  applied_at timestamptz not null default now()
);

insert into private.schema_migrations (version)
values ('20261105170000_init_crm')
on conflict (version) do nothing;
