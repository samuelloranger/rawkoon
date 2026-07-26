-- Convert the single qBittorrent integration into a generalized download-client record.
UPDATE "integrations"
SET
  "type" = 'download-client',
  "config" = COALESCE("config", '{}'::jsonb)
    || jsonb_build_object('client_type', 'qbittorrent')
    || CASE
         WHEN ("config" ->> 'label') IS NULL
         THEN jsonb_build_object('label', 'rawkoon')
         ELSE '{}'::jsonb
       END
WHERE "type" = 'qbittorrent';
