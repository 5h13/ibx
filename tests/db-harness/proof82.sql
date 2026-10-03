-- Build 82 (5H13 Shortcuts) proof: each user reads and writes only their own shortcuts row.
\set ON_ERROR_STOP 1
select proof.as_user('00000000-0000-0000-0000-000000000015');
insert into user_shortcuts(user_id, items) values (auth.uid(), '["/finance/accounts-payable","new:po"]');
select proof.ok((select items->>1 from user_shortcuts where user_id = auth.uid()) = 'new:po', 'a user saves an ordered list of shortcuts');
update user_shortcuts set items = '["new:po"]' where user_id = auth.uid();
select proof.ok((select jsonb_array_length(items) from user_shortcuts where user_id = auth.uid()) = 1, 'a user changes their own shortcuts');
select proof.as_user('00000000-0000-0000-0000-000000000013');
select proof.ok((select count(*) from user_shortcuts) = 0, 'another user cannot see them');
select proof.fails($$insert into user_shortcuts(user_id, items) values ('00000000-0000-0000-0000-000000000015', '[]')$$, 'row-level security', 'nobody writes another user''s shortcuts');
select proof.fails($$insert into user_shortcuts(user_id, items) values (auth.uid(), '{"a":1}')$$, 'check constraint', 'shortcuts must be a list');
\echo == Build 82 proof passed
