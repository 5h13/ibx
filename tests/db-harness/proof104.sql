-- Build 104 (usernames, nicknames, users without email) proof. Rolled back.
\set ON_ERROR_STOP 1
begin;
select proof.as_owner();
select proof.set('b', (select id::text from businesses where code = 'PILI'));
create or replace function pg_temp.mk(p_id uuid, p_first text, p_last text) returns text language plpgsql as $$
begin
  insert into auth.users(id, email) values (p_id, p_id::text || '@nomail.5h13.invalid');
  insert into users(id, email, email_is_login_only, full_name, first_name, last_name, role, business_id)
  values (p_id, p_id::text || '@nomail.5h13.invalid', true, p_first || ' ' || p_last, p_first, p_last, 'sales', proof.get('b')::uuid);
  return (select username from users where id = p_id);
end $$;

\echo == A. default usernames
select proof.ok(pg_temp.mk('00000000-0000-0000-0000-0000010400a1', 'Alfredo', 'Santiago') = 'A.Santiago', 'Alfredo Santiago → A.Santiago');
select proof.ok(pg_temp.mk('00000000-0000-0000-0000-0000010400a2', 'Andres', 'Santiago') = 'A.Santiago2', 'a taken name gets a number → A.Santiago2');
select proof.ok(pg_temp.mk('00000000-0000-0000-0000-0000010400a3', 'Maria', 'Dela Cruz') = 'M.DelaCruz', 'two-word surname without the space → M.DelaCruz');
select proof.ok(pg_temp.mk('00000000-0000-0000-0000-0000010400a4', 'José', 'Peña') = 'J.Pena', 'accents folded → J.Pena');
select proof.ok(pg_temp.mk('00000000-0000-0000-0000-0000010400a5', 'Shiena Lyn', 'Chavez') = '5H13', 'Shiena Lyn Chavez → 5H13');
select proof.ok((select welcome_name = '5H13' from users where id = '00000000-0000-0000-0000-0000010400a5'), '…and she is greeted as 5H13');
select proof.ok(pg_temp.mk('00000000-0000-0000-0000-0000010400a6', 'Lyn', 'Chavez') = 'L.Chavez', '5H13 is taken already → the normal pattern (L.Chavez)');
select proof.ok(public.username_base('Shiena', 'Chavez') = '5H13' and public.username_base('shiena  lyn', ' CHAVEZ') = '5H13', 'Shiena Chavez variants, any case or spacing');
select proof.ok((select count(*) = 0 from users where username is null), 'every existing account has a username');

\echo == B. unique whatever the case; format
select proof.fails($$update users set username = 'a.santiago' where id = '00000000-0000-0000-0000-0000010400a3'$$, 'users_username_lower_key', 'usernames are unique whatever the case');
select proof.fails($$update users set username = 'has space' where id = '00000000-0000-0000-0000-0000010400a3'$$, 'users_username_format', 'no spaces in usernames');

\echo == C. My Profile
select proof.as_user('00000000-0000-0000-0000-0000010400a1');
select public.profile_update('Fred.Santiago', 'Fred');
select proof.ok((select username = 'Fred.Santiago' and nickname = 'Fred' from users where id = '00000000-0000-0000-0000-0000010400a1'), 'the user changes the username and sets the nickname "Fred"');
select proof.fails($$select public.profile_update('M.DELACRUZ', null)$$, 'already taken', 'someone else''s username is refused');
select proof.fails($$select public.profile_update('ab', null)$$, '3 to 30', 'too short is refused');
select public.profile_update('Fred.Santiago', '  ');
select proof.ok((select nickname is null from users where id = '00000000-0000-0000-0000-0000010400a1'), 'a blank nickname shows the full name again');

\echo == D. the login lookup is server-only
select proof.fails($$select public.login_email_for('Fred.Santiago')$$, 'permission denied', 'a signed-in user cannot look up login emails');
reset role; select proof.as_owner();
select proof.ok(public.login_email_for('fred.santiago') = '00000000-0000-0000-0000-0000010400a1@nomail.5h13.invalid', 'the server finds the login behind a username, whatever the case');
update users set is_active = false where id = '00000000-0000-0000-0000-0000010400a1';
select proof.ok(public.login_email_for('Fred.Santiago') is null, 'an inactive account cannot sign in by username');
reset role;
rollback;
