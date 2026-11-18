-- Department Head role.
--
-- Run this file on its own FIRST. PostgreSQL cannot use a newly added enum value in the same
-- transaction that adds it, so everything that references 'manager' lives in 008.
alter type app_role add value if not exists 'manager';
