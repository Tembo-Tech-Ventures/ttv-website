/**
 * SQL for a message's moderation reasons after more are added: the reasons it has, then each new one
 * it lacks, in order. Both arguments are SQL expressions holding JSON arrays, never input.
 */
export const mergedReasons = (current: string, added: string) => `(SELECT json_group_array(value) FROM (
    SELECT value FROM json_each(${current})
    UNION ALL SELECT value FROM json_each(${added}) WHERE value NOT IN (SELECT value FROM json_each(${current}))))`;
