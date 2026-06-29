-- One-time cleanup: remove groups orphaned before empty-group pruning existed.
-- Groups are always created with members (import, manual create, bill push), so a
-- group with no member transactions is a leftover shell — e.g. from deleting a
-- bill (which removed its pushed transactions but not the group it created), from
-- deleting a group's last transaction, or from removing its last member.
--
-- The migration runner uses the admin pool (BYPASSRLS), so this purges across all
-- users. From now on the app prunes empty groups on every removal path
-- (transaction delete, group /members, bill delete) via lib/groups.pruneEmptyGroups.
DELETE FROM groups g
WHERE NOT EXISTS (SELECT 1 FROM transactions t WHERE t.group_id = g.id);
