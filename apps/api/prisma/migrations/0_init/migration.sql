-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "MediaRequestStatus" AS ENUM ('pending', 'approved', 'denied', 'available');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT '',
    "email" TEXT NOT NULL,
    "email_verified" BOOLEAN NOT NULL DEFAULT false,
    "password_hash" TEXT,
    "is_admin" BOOLEAN,
    "last_login" TIMESTAMP(3),
    "created_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3) NOT NULL,
    "last_activity" TIMESTAMP(3),
    "first_name" TEXT,
    "last_name" TEXT,
    "locale" TEXT,
    "avatar_url" TEXT,
    "nav_position" TEXT,
    "dashboard_config" JSONB,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" SERIAL NOT NULL,
    "user_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "read" BOOLEAN NOT NULL DEFAULT false,
    "read_at" TIMESTAMP(3),
    "url" TEXT,
    "image_url" TEXT,
    "notification_metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integrations" (
    "id" SERIAL NOT NULL,
    "type" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "config" JSONB,
    "created_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3),

    CONSTRAINT "integrations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ba_api_keys" (
    "id" TEXT NOT NULL,
    "config_id" TEXT NOT NULL DEFAULT 'default',
    "name" TEXT,
    "start" TEXT,
    "reference_id" TEXT NOT NULL,
    "prefix" TEXT,
    "key" TEXT NOT NULL,
    "refill_interval" INTEGER,
    "refill_amount" INTEGER,
    "last_refill_at" TIMESTAMP(3),
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "rate_limit_enabled" BOOLEAN NOT NULL DEFAULT true,
    "rate_limit_time_window" INTEGER,
    "rate_limit_max" INTEGER,
    "request_count" INTEGER NOT NULL DEFAULT 0,
    "remaining" INTEGER,
    "last_request" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "permissions" TEXT,
    "metadata" TEXT,

    CONSTRAINT "ba_api_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "oidc_providers" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "discovery_url" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "client_secret" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "icon_url" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "oidc_providers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_subscriptions" (
    "id" SERIAL NOT NULL,
    "user_id" TEXT NOT NULL,
    "subscription_info" TEXT NOT NULL,
    "endpoint" TEXT,
    "created_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3),
    "device_name" TEXT,
    "os_name" TEXT,
    "os_version" TEXT,
    "browser_name" TEXT,
    "browser_version" TEXT,
    "platform" TEXT,

    CONSTRAINT "user_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "activity_logs" (
    "id" SERIAL NOT NULL,
    "type" VARCHAR(50) NOT NULL,
    "user_id" TEXT,
    "payload" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "activity_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invitations" (
    "id" SERIAL NOT NULL,
    "email" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'pending',
    "expires_at" TIMESTAMP(3) NOT NULL,
    "invited_by" TEXT,
    "locale" TEXT NOT NULL DEFAULT 'en',
    "is_admin" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "accepted_at" TIMESTAMP(3),

    CONSTRAINT "invitations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_channels" (
    "id" SERIAL NOT NULL,
    "user_id" TEXT NOT NULL,
    "type" VARCHAR(20) NOT NULL,
    "label" VARCHAR(100) NOT NULL,
    "config" JSONB NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notification_channels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "qbittorrent_request_logs" (
    "id" SERIAL NOT NULL,
    "method" VARCHAR(10) NOT NULL,
    "endpoint" VARCHAR(255) NOT NULL,
    "request_path" VARCHAR(512) NOT NULL,
    "status_code" INTEGER,
    "ok" BOOLEAN NOT NULL DEFAULT false,
    "duration_ms" INTEGER NOT NULL,
    "response_bytes" INTEGER,
    "auth_retried" BOOLEAN NOT NULL DEFAULT false,
    "rid" INTEGER,
    "full_update" BOOLEAN,
    "item_count" INTEGER,
    "removed_count" INTEGER,
    "error_message" TEXT,
    "meta" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "qbittorrent_request_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "watchlist_items" (
    "id" SERIAL NOT NULL,
    "user_id" TEXT NOT NULL,
    "tmdb_id" INTEGER NOT NULL,
    "media_type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "poster_url" TEXT,
    "overview" TEXT,
    "release_year" INTEGER,
    "vote_average" DOUBLE PRECISION,
    "added_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "movie_release_date" DATE,
    "release_reminder_sent_for" VARCHAR(10),

    CONSTRAINT "watchlist_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quality_profiles" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "min_resolution" INTEGER NOT NULL DEFAULT 1080,
    "preferred_sources" TEXT[],
    "preferred_codecs" TEXT[],
    "preferred_languages" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "prioritized_trackers" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "prefer_tracker_over_quality" BOOLEAN NOT NULL DEFAULT false,
    "max_size_gb" DOUBLE PRECISION,
    "require_hdr" BOOLEAN NOT NULL DEFAULT false,
    "prefer_hdr" BOOLEAN NOT NULL DEFAULT false,
    "cutoff_resolution" INTEGER,
    "min_seeders" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "quality_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "custom_formats" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "conditions" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "custom_formats_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quality_profile_custom_formats" (
    "id" SERIAL NOT NULL,
    "quality_profile_id" INTEGER NOT NULL,
    "custom_format_id" INTEGER NOT NULL,
    "score" INTEGER NOT NULL DEFAULT 0,
    "required" BOOLEAN NOT NULL DEFAULT false,
    "forbidden" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "quality_profile_custom_formats_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ba_sessions" (
    "id" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "token" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "ip_address" TEXT,
    "user_agent" TEXT,
    "provider_id" TEXT,
    "user_id" TEXT NOT NULL,

    CONSTRAINT "ba_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ba_accounts" (
    "id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "provider_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "access_token" TEXT,
    "refresh_token" TEXT,
    "id_token" TEXT,
    "access_token_expires_at" TIMESTAMP(3),
    "refresh_token_expires_at" TIMESTAMP(3),
    "scope" TEXT,
    "password" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ba_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ba_verifications" (
    "id" TEXT NOT NULL,
    "identifier" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ba_verifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ba_passkeys" (
    "id" TEXT NOT NULL,
    "name" TEXT,
    "public_key" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "credential_id" TEXT NOT NULL,
    "counter" INTEGER NOT NULL,
    "device_type" TEXT NOT NULL,
    "backed_up" BOOLEAN NOT NULL,
    "transports" TEXT,
    "created_at" TIMESTAMP(3),
    "aaguid" TEXT,

    CONSTRAINT "ba_passkeys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "library_media" (
    "id" SERIAL NOT NULL,
    "tmdb_id" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "sort_title" TEXT,
    "year" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'wanted',
    "tmdb_status" TEXT,
    "tmdb_status_refreshed_at" TIMESTAMP(3),
    "monitored" BOOLEAN NOT NULL DEFAULT true,
    "poster_url" TEXT,
    "overview" TEXT,
    "overrides" JSONB,
    "digital_release_date" TIMESTAMP(3),
    "quality_profile_id" INTEGER,
    "search_attempts" INTEGER NOT NULL DEFAULT 0,
    "added_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "library_media_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "library_episodes" (
    "id" SERIAL NOT NULL,
    "media_id" INTEGER NOT NULL,
    "season" INTEGER NOT NULL,
    "episode" INTEGER NOT NULL,
    "title" TEXT,
    "air_date" DATE,
    "status" TEXT NOT NULL DEFAULT 'wanted',
    "monitored" BOOLEAN NOT NULL DEFAULT true,
    "tmdb_episode_id" INTEGER,
    "downloaded_at" TIMESTAMP(3),
    "search_attempts" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "library_episodes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "download_history" (
    "id" SERIAL NOT NULL,
    "media_id" INTEGER,
    "episode_id" INTEGER,
    "release_title" TEXT NOT NULL,
    "indexer" TEXT,
    "torrent_hash" TEXT,
    "download_url" TEXT,
    "quality_parsed" JSONB,
    "grabbed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),
    "failed" BOOLEAN NOT NULL DEFAULT false,
    "fail_reason" TEXT,
    "is_upgrade" BOOLEAN NOT NULL DEFAULT false,
    "ai_picked" BOOLEAN NOT NULL DEFAULT false,
    "post_process_error" TEXT,
    "post_process_destination_path" TEXT,

    CONSTRAINT "download_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "library_attention_alerts" (
    "id" SERIAL NOT NULL,
    "media_id" INTEGER NOT NULL,
    "episode_id" INTEGER,
    "season" INTEGER,
    "scope_type" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "detail" TEXT,
    "download_history_id" INTEGER,
    "search_attempts" INTEGER,
    "grabbed_at" TIMESTAMP(3),
    "library_status_snapshot" TEXT,
    "dismissed_at" TIMESTAMP(3),
    "resolved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "library_attention_alerts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "grab_blocklist" (
    "id" SERIAL NOT NULL,
    "torrent_hash" TEXT,
    "release_title" TEXT NOT NULL,
    "indexer" TEXT,
    "media_id" INTEGER,
    "episode_id" INTEGER,
    "reason" TEXT,
    "blocked_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "grab_blocklist_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "media_settings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "movies_library_path" TEXT,
    "shows_library_path" TEXT,
    "file_operation" TEXT NOT NULL DEFAULT 'hardlink',
    "movie_template" TEXT NOT NULL DEFAULT '{title} ({year}) [{resolution} {source}]',
    "episode_template" TEXT NOT NULL DEFAULT '{show}/Season {season}/{show} - S{season:02}E{episode:02} - {title} [{resolution} {source}]',
    "min_seed_ratio" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "post_processing_enabled" BOOLEAN NOT NULL DEFAULT false,
    "default_quality_profile_id" INTEGER,
    "active_indexer_manager" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "media_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app_settings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "country_code" VARCHAR(2) NOT NULL DEFAULT 'US',
    "upcoming_window_months" INTEGER NOT NULL DEFAULT 12,
    "upcoming_languages" TEXT NOT NULL DEFAULT 'en,fr',
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "app_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "media_files" (
    "id" SERIAL NOT NULL,
    "media_id" INTEGER,
    "episode_id" INTEGER,
    "file_path" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "size_bytes" BIGINT NOT NULL,
    "duration_secs" DOUBLE PRECISION,
    "release_group" TEXT,
    "video_codec" TEXT,
    "video_profile" TEXT,
    "width" INTEGER,
    "height" INTEGER,
    "frame_rate" DOUBLE PRECISION,
    "bit_depth" INTEGER,
    "video_bitrate" INTEGER,
    "hdr_format" TEXT,
    "resolution" INTEGER,
    "source" TEXT,
    "audio_format" TEXT,
    "is_proper" BOOLEAN NOT NULL DEFAULT false,
    "audio_tracks" JSONB NOT NULL DEFAULT '[]',
    "subtitle_tracks" JSONB NOT NULL DEFAULT '[]',
    "language_tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "scanned_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "media_files_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "library_health_log" (
    "id" SERIAL NOT NULL,
    "status" TEXT NOT NULL,
    "trigger" TEXT NOT NULL DEFAULT 'manual',
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3) NOT NULL,
    "duration_ms" INTEGER NOT NULL,
    "summary" JSONB NOT NULL,
    "issues" JSONB NOT NULL,
    "warnings" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "error" TEXT,

    CONSTRAINT "library_health_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "media_requests" (
    "id" SERIAL NOT NULL,
    "tmdb_id" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "poster_url" TEXT,
    "year" INTEGER,
    "requested_by_id" TEXT NOT NULL,
    "status" "MediaRequestStatus" NOT NULL DEFAULT 'pending',
    "quality_profile_id" INTEGER,
    "library_media_id" INTEGER,
    "deny_reason" TEXT,
    "decided_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decided_at" TIMESTAMP(3),

    CONSTRAINT "media_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "discover_dismissals" (
    "id" SERIAL NOT NULL,
    "user_id" TEXT NOT NULL,
    "tmdb_id" INTEGER NOT NULL,
    "media_type" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "discover_dismissals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ix_users_email" ON "users"("email");

-- CreateIndex
CREATE INDEX "ix_notifications_created_at" ON "notifications"("created_at");

-- CreateIndex
CREATE INDEX "ix_notifications_user_id" ON "notifications"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "ix_integrations_type" ON "integrations"("type");

-- CreateIndex
CREATE INDEX "ix_ba_api_keys_key" ON "ba_api_keys"("key");

-- CreateIndex
CREATE INDEX "ix_ba_api_keys_reference_id" ON "ba_api_keys"("reference_id");

-- CreateIndex
CREATE INDEX "ix_ba_api_keys_config_id" ON "ba_api_keys"("config_id");

-- CreateIndex
CREATE UNIQUE INDEX "ba_api_keys_name_key" ON "ba_api_keys"("name");

-- CreateIndex
CREATE UNIQUE INDEX "oidc_providers_slug_key" ON "oidc_providers"("slug");

-- CreateIndex
CREATE INDEX "ix_user_subscriptions_endpoint" ON "user_subscriptions"("endpoint");

-- CreateIndex
CREATE INDEX "ix_user_subscriptions_user_id" ON "user_subscriptions"("user_id");

-- CreateIndex
CREATE INDEX "ix_activity_logs_created_at" ON "activity_logs"("created_at");

-- CreateIndex
CREATE INDEX "ix_activity_logs_type" ON "activity_logs"("type");

-- CreateIndex
CREATE INDEX "ix_activity_logs_user_id" ON "activity_logs"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "ix_invitations_token" ON "invitations"("token");

-- CreateIndex
CREATE UNIQUE INDEX "ix_invitations_email_status" ON "invitations"("email", "status");

-- CreateIndex
CREATE INDEX "ix_notification_channels_user_id" ON "notification_channels"("user_id");

-- CreateIndex
CREATE INDEX "ix_qbittorrent_request_logs_created_at" ON "qbittorrent_request_logs"("created_at");

-- CreateIndex
CREATE INDEX "ix_qbittorrent_request_logs_endpoint_created_at" ON "qbittorrent_request_logs"("endpoint", "created_at");

-- CreateIndex
CREATE INDEX "ix_qbittorrent_request_logs_ok_created_at" ON "qbittorrent_request_logs"("ok", "created_at");

-- CreateIndex
CREATE INDEX "ix_watchlist_user_added_at" ON "watchlist_items"("user_id", "added_at");

-- CreateIndex
CREATE UNIQUE INDEX "uq_watchlist_user_tmdb_type" ON "watchlist_items"("user_id", "tmdb_id", "media_type");

-- CreateIndex
CREATE UNIQUE INDEX "quality_profiles_name_key" ON "quality_profiles"("name");

-- CreateIndex
CREATE UNIQUE INDEX "custom_formats_name_key" ON "custom_formats"("name");

-- CreateIndex
CREATE INDEX "ix_qp_custom_format_profile" ON "quality_profile_custom_formats"("quality_profile_id");

-- CreateIndex
CREATE UNIQUE INDEX "quality_profile_custom_formats_quality_profile_id_custom_fo_key" ON "quality_profile_custom_formats"("quality_profile_id", "custom_format_id");

-- CreateIndex
CREATE UNIQUE INDEX "ba_sessions_token_key" ON "ba_sessions"("token");

-- CreateIndex
CREATE INDEX "ix_ba_sessions_user_id" ON "ba_sessions"("user_id");

-- CreateIndex
CREATE INDEX "ix_ba_accounts_user_id" ON "ba_accounts"("user_id");

-- CreateIndex
CREATE INDEX "ix_ba_passkeys_credential_id" ON "ba_passkeys"("credential_id");

-- CreateIndex
CREATE INDEX "ix_ba_passkeys_user_id" ON "ba_passkeys"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "library_media_tmdb_id_key" ON "library_media"("tmdb_id");

-- CreateIndex
CREATE INDEX "ix_library_media_type" ON "library_media"("type");

-- CreateIndex
CREATE INDEX "ix_library_media_status" ON "library_media"("status");

-- CreateIndex
CREATE INDEX "ix_library_media_quality_profile_id" ON "library_media"("quality_profile_id");

-- CreateIndex
CREATE INDEX "ix_library_episodes_media_id" ON "library_episodes"("media_id");

-- CreateIndex
CREATE UNIQUE INDEX "library_episodes_media_id_season_episode_key" ON "library_episodes"("media_id", "season", "episode");

-- CreateIndex
CREATE INDEX "ix_download_history_media_id" ON "download_history"("media_id");

-- CreateIndex
CREATE INDEX "ix_download_history_episode_id" ON "download_history"("episode_id");

-- CreateIndex
CREATE UNIQUE INDEX "ix_download_history_torrent_hash" ON "download_history"("torrent_hash");

-- CreateIndex
CREATE INDEX "ix_library_attention_alert_media_id" ON "library_attention_alerts"("media_id");

-- CreateIndex
CREATE INDEX "ix_library_attention_alert_status" ON "library_attention_alerts"("status");

-- CreateIndex
CREATE INDEX "ix_library_attention_alert_episode_id" ON "library_attention_alerts"("episode_id");

-- CreateIndex
CREATE INDEX "ix_grab_blocklist_hash" ON "grab_blocklist"("torrent_hash");

-- CreateIndex
CREATE INDEX "ix_grab_blocklist_media_id" ON "grab_blocklist"("media_id");

-- CreateIndex
CREATE INDEX "ix_grab_blocklist_episode_id" ON "grab_blocklist"("episode_id");

-- CreateIndex
CREATE INDEX "ix_media_files_media_id" ON "media_files"("media_id");

-- CreateIndex
CREATE INDEX "ix_media_files_episode_id" ON "media_files"("episode_id");

-- CreateIndex
CREATE INDEX "ix_media_files_file_path" ON "media_files"("file_path");

-- CreateIndex
CREATE INDEX "ix_media_files_language_tags" ON "media_files" USING GIN ("language_tags");

-- CreateIndex
CREATE INDEX "ix_library_health_log_started_at" ON "library_health_log"("started_at");

-- CreateIndex
CREATE INDEX "ix_media_request_requested_by_id" ON "media_requests"("requested_by_id");

-- CreateIndex
CREATE INDEX "ix_media_request_library_media_id" ON "media_requests"("library_media_id");

-- CreateIndex
CREATE INDEX "ix_media_request_quality_profile_id" ON "media_requests"("quality_profile_id");

-- CreateIndex
CREATE INDEX "ix_media_request_decided_by_id" ON "media_requests"("decided_by_id");

-- CreateIndex
CREATE UNIQUE INDEX "media_requests_tmdb_id_type_key" ON "media_requests"("tmdb_id", "type");

-- CreateIndex
CREATE INDEX "ix_discover_dismissals_user_id" ON "discover_dismissals"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_discover_dismissal_user_tmdb_type" ON "discover_dismissals"("user_id", "tmdb_id", "media_type");

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ba_api_keys" ADD CONSTRAINT "ba_api_keys_reference_id_fkey" FOREIGN KEY ("reference_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_subscriptions" ADD CONSTRAINT "user_subscriptions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity_logs" ADD CONSTRAINT "activity_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_invited_by_fkey" FOREIGN KEY ("invited_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_channels" ADD CONSTRAINT "notification_channels_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "watchlist_items" ADD CONSTRAINT "watchlist_items_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quality_profile_custom_formats" ADD CONSTRAINT "quality_profile_custom_formats_quality_profile_id_fkey" FOREIGN KEY ("quality_profile_id") REFERENCES "quality_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quality_profile_custom_formats" ADD CONSTRAINT "quality_profile_custom_formats_custom_format_id_fkey" FOREIGN KEY ("custom_format_id") REFERENCES "custom_formats"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ba_sessions" ADD CONSTRAINT "ba_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ba_accounts" ADD CONSTRAINT "ba_accounts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ba_passkeys" ADD CONSTRAINT "ba_passkeys_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "library_media" ADD CONSTRAINT "library_media_quality_profile_id_fkey" FOREIGN KEY ("quality_profile_id") REFERENCES "quality_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "library_episodes" ADD CONSTRAINT "library_episodes_media_id_fkey" FOREIGN KEY ("media_id") REFERENCES "library_media"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "download_history" ADD CONSTRAINT "download_history_media_id_fkey" FOREIGN KEY ("media_id") REFERENCES "library_media"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "download_history" ADD CONSTRAINT "download_history_episode_id_fkey" FOREIGN KEY ("episode_id") REFERENCES "library_episodes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "library_attention_alerts" ADD CONSTRAINT "library_attention_alerts_media_id_fkey" FOREIGN KEY ("media_id") REFERENCES "library_media"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "library_attention_alerts" ADD CONSTRAINT "library_attention_alerts_episode_id_fkey" FOREIGN KEY ("episode_id") REFERENCES "library_episodes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "grab_blocklist" ADD CONSTRAINT "grab_blocklist_media_id_fkey" FOREIGN KEY ("media_id") REFERENCES "library_media"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "grab_blocklist" ADD CONSTRAINT "grab_blocklist_episode_id_fkey" FOREIGN KEY ("episode_id") REFERENCES "library_episodes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "media_settings" ADD CONSTRAINT "media_settings_default_quality_profile_id_fkey" FOREIGN KEY ("default_quality_profile_id") REFERENCES "quality_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "media_files" ADD CONSTRAINT "media_files_media_id_fkey" FOREIGN KEY ("media_id") REFERENCES "library_media"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "media_files" ADD CONSTRAINT "media_files_episode_id_fkey" FOREIGN KEY ("episode_id") REFERENCES "library_episodes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "media_requests" ADD CONSTRAINT "media_requests_requested_by_id_fkey" FOREIGN KEY ("requested_by_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "media_requests" ADD CONSTRAINT "media_requests_quality_profile_id_fkey" FOREIGN KEY ("quality_profile_id") REFERENCES "quality_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "media_requests" ADD CONSTRAINT "media_requests_library_media_id_fkey" FOREIGN KEY ("library_media_id") REFERENCES "library_media"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "media_requests" ADD CONSTRAINT "media_requests_decided_by_id_fkey" FOREIGN KEY ("decided_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discover_dismissals" ADD CONSTRAINT "discover_dismissals_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

