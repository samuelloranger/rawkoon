DROP INDEX "ix_download_history_torrent_hash";
CREATE INDEX "ix_download_history_torrent_hash" ON "download_history"("torrent_hash");
