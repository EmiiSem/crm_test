import fs from 'node:fs'
import pg from 'pg'
import { loadEnv } from './load-env.mjs'

loadEnv()

const reset = process.argv.includes('--reset')
const migrationPath = 'supabase/migrations/20261105170000_init_crm.sql'

const client = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 20000,
})

await client.connect()

try {
  if (reset) {
    console.log('Сбрасываю таблицы CRM…')
    await client.query(`
      drop trigger if exists on_auth_user_created on auth.users;
      drop table if exists public.task_status_history cascade;
      drop table if exists public.tasks cascade;
      drop table if exists public.objects cascade;
      drop table if exists public.profiles cascade;
      drop function if exists public.handle_new_user() cascade;
      drop function if exists public.transition_task(uuid, public.task_status, text) cascade;
      drop function if exists public.is_assigner() cascade;
      drop function if exists public.can_read_profile(uuid) cascade;
      drop schema if exists private cascade;
      drop type if exists public.task_status cascade;
      drop type if exists public.user_role cascade;
    `)
  }

  const applied = await client.query(`select to_regclass('private.schema_migrations') as name`)
  const already = applied.rows[0]?.name
    ? (
        await client.query(
          `select 1 from private.schema_migrations where version = '20261105170000_init_crm'`,
        )
      ).rowCount > 0
    : false

  if (!already) {
    console.log('Применяю миграцию…')
    await client.query(fs.readFileSync(migrationPath, 'utf8'))
  } else {
    console.log('Миграция уже применена.')
  }

  const users = [
    ['TEST_ASSIGNER', 'assigner'],
    ['TEST_EXECUTOR1', 'executor'],
    ['TEST_EXECUTOR2', 'executor'],
  ]

  for (const [prefix, role] of users) {
    await ensureUser({
      email: required(`${prefix}_EMAIL`),
      password: required(`${prefix}_PASSWORD`),
      fullName: required(`${prefix}_NAME`),
      role,
    })
  }

  console.log('Заполняю демо-данные…')
  await client.query('select private.seed_demo()')
  await verifyAccess()
  console.log('Готово. Пароли тестовых сотрудников лежат в .env и в репозиторий не входят.')
} finally {
  await client.end()
}

function required(name) {
  const value = process.env[name]
  if (!value) throw new Error(`В .env нет ${name}`)
  return value
}

async function ensureUser({ email, password, fullName, role }) {
  const existing = await client.query('select id from auth.users where lower(email) = lower($1)', [email])
  let userId = existing.rows[0]?.id

  if (!userId) {
    userId = await insertAuthUser({ email, password, fullName, role })
    console.log(`Создан пользователь ${email}`)
  } else {
    await client.query(
      `
        update auth.users
        set encrypted_password = extensions.crypt($2, extensions.gen_salt('bf')),
            email_confirmed_at = coalesce(email_confirmed_at, now()),
            raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || jsonb_build_object('role', $3::text),
            raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb) || jsonb_build_object('full_name', $4::text),
            updated_at = now()
        where id = $1
      `,
      [userId, password, role, fullName],
    )
    console.log(`Обновлён пользователь ${email}`)
  }

  await client.query(
    `
      insert into public.profiles (id, email, full_name, role)
      values ($1, $2, $3, $4::public.user_role)
      on conflict (id) do update
        set email = excluded.email,
            full_name = excluded.full_name,
            role = excluded.role
    `,
    [userId, email, fullName, role],
  )
  await ensureIdentity(userId, email)
}

async function insertAuthUser({ email, password, fullName, role }) {
  const instance = await client.query(`
    select coalesce(
      (select id::text from auth.instances limit 1),
      '00000000-0000-0000-0000-000000000000'
    ) as id
  `).catch(async () => {
    return { rows: [{ id: '00000000-0000-0000-0000-000000000000' }] }
  })

  const inserted = await client.query(
    `
      insert into auth.users (
        instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
        raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
        confirmation_token, email_change, email_change_token_new, recovery_token,
        email_change_token_current, reauthentication_token, is_sso_user, is_anonymous
      ) values (
        $1::uuid, gen_random_uuid(), 'authenticated', 'authenticated', $2,
        extensions.crypt($3, extensions.gen_salt('bf')),
        now(),
        jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email'), 'role', $4::text),
        jsonb_build_object('full_name', $5::text),
        now(), now(),
        '', '', '', '',
        '', '', false, false
      )
      returning id
    `,
    [instance.rows[0].id, email, password, role, fullName],
  )

  return inserted.rows[0].id
}

async function ensureIdentity(userId, email) {
  await client.query(
    `
      insert into auth.identities (
        id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at
      )
      select
        gen_random_uuid(),
        $1::uuid,
        jsonb_build_object('sub', $2::text, 'email', $3::text, 'email_verified', true),
        'email',
        $2::text,
        now(),
        now(),
        now()
      where not exists (
        select 1 from auth.identities where user_id = $1::uuid and provider = 'email'
      )
    `,
    [userId, userId, email],
  )
}

async function verifyAccess() {
  console.log('Проверяю права…')
  const people = await client.query(`
    select email, id, role from public.profiles
    where email in ('anna.petrova@crm.test', 'ivan.sorokin@crm.test', 'maria.lebedeva@crm.test')
  `)
  const byEmail = Object.fromEntries(people.rows.map((row) => [row.email, row]))
  const anna = byEmail['anna.petrova@crm.test']
  const ivan = byEmail['ivan.sorokin@crm.test']
  const maria = byEmail['maria.lebedeva@crm.test']

  const ivanObjects = await asUser(ivan.id, 'select id from public.objects order by name')
  const allObjects = await asUser(anna.id, 'select id from public.objects')
  if (ivanObjects.length >= allObjects.length) {
    throw new Error('Исполнитель видит не меньше объектов, чем постановщик')
  }

  const ivanTasks = await asUser(ivan.id, 'select id, assignee_id from public.tasks')
  if (ivanTasks.some((task) => task.assignee_id !== ivan.id)) {
    throw new Error('Исполнитель видит чужую задачу')
  }

  const mariaTask = await client.query(
    'select id from public.tasks where assignee_id = $1 and status = $2 limit 1',
    [maria.id, 'new'],
  )
  await expectFailure(
    ivan.id,
    'select * from public.transition_task($1::uuid, $2::public.task_status, null)',
    [mariaTask.rows[0].id, 'in_progress'],
    ['TASK_NOT_FOUND', 'FORBIDDEN'],
  )

  const ownNew = await client.query(
    'select id from public.tasks where assignee_id = $1 and status = $2 limit 1',
    [ivan.id, 'new'],
  )
  await expectFailure(
    ivan.id,
    'select * from public.transition_task($1::uuid, $2::public.task_status, null)',
    [ownNew.rows[0].id, 'accepted'],
    ['FORBIDDEN_TRANSITION'],
  )
  await expectFailure(
    anna.id,
    'select * from public.transition_task($1::uuid, $2::public.task_status, null)',
    [ownNew.rows[0].id, 'in_progress'],
    ['FORBIDDEN'],
  )

  await expectFailure(
    ivan.id,
    'insert into public.task_status_history (task_id, changed_by, from_status, to_status) values ($1, $2, null, $3::public.task_status)',
    [ownNew.rows[0].id, ivan.id, 'new'],
    ['permission denied', 'HISTORY_IMMUTABLE'],
  )
  await expectFailure(
    anna.id,
    'update public.task_status_history set comment = $1 where task_id = $2',
    ['подделка', ownNew.rows[0].id],
    ['permission denied', 'HISTORY_IMMUTABLE'],
  )
  await expectFailure(
    anna.id,
    'delete from public.task_status_history where task_id = $1',
    [ownNew.rows[0].id],
    ['permission denied', 'HISTORY_IMMUTABLE'],
  )

  const changed = await asUser(
    ivan.id,
    'update public.tasks set title = $1 where id = $2 returning id',
    ['Чужая правка', ownNew.rows[0].id],
  )
  if (changed.length !== 0) throw new Error('Исполнитель смог изменить текст задачи')

  await expectFailure(
    anna.id,
    'update public.tasks set status = $1::public.task_status where id = $2',
    ['accepted', ownNew.rows[0].id],
    ['permission denied', 'FORBIDDEN_TRANSITION'],
  )

  const moved = await asUser(
    ivan.id,
    'select * from public.transition_task($1::uuid, $2::public.task_status, $3)',
    [ownNew.rows[0].id, 'in_progress', 'Беру в работу'],
  )
  if (moved[0]?.status !== 'in_progress') throw new Error('Легальный переход не сработал')

  const after = await client.query('select status from public.tasks where id = $1', [ownNew.rows[0].id])
  if (after.rows[0].status !== 'new') {
    throw new Error('Проверка перехода не откатилась и испортила демо-данные')
  }
  console.log('Права в базе подтверждены, демо-данные не изменены.')
}

async function asUser(userId, sql, params = []) {
  await client.query('begin')
  try {
    await assume(userId)
    const result = await client.query(sql, params)
    return result.rows
  } finally {
    await client.query('rollback')
  }
}

async function expectFailure(userId, sql, params, codes) {
  await client.query('begin')
  try {
    await assume(userId)
    await client.query(sql, params)
    throw new Error(`Ожидался отказ (${codes.join(', ')}), но запрос прошёл: ${sql}`)
  } catch (error) {
    const message = String(error.message)
    if (!codes.some((code) => message.toLowerCase().includes(code.toLowerCase()))) {
      throw error
    }
  } finally {
    await client.query('rollback')
  }
}

async function assume(userId) {
  await client.query(`select set_config('request.jwt.claim.sub', $1, true)`, [userId])
  await client.query(`select set_config('request.jwt.claim.role', 'authenticated', true)`)
  await client.query(`select set_config('request.jwt.claims', $1, true)`, [
    JSON.stringify({ sub: userId, role: 'authenticated' }),
  ])
  await client.query('set local role authenticated')
}
