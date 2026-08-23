CREATE TABLE `audit_events` (
	`id` text PRIMARY KEY NOT NULL,
	`space_id` text NOT NULL,
	`actor_user_id` text NOT NULL,
	`action` text NOT NULL,
	`resource_type` text NOT NULL,
	`resource_id` text NOT NULL,
	`occurred_at` integer NOT NULL,
	`dedupe_key` text,
	FOREIGN KEY (`space_id`) REFERENCES `family_spaces`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`actor_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `audit_events_dedupe_key_uq` ON `audit_events` (`dedupe_key`);--> statement-breakpoint
CREATE INDEX `audit_events_resource_time_idx` ON `audit_events` (`resource_type`,`resource_id`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `audit_events_space_time_idx` ON `audit_events` (`space_id`,`occurred_at`);--> statement-breakpoint
CREATE TABLE `custodianships` (
	`id` text PRIMARY KEY NOT NULL,
	`space_id` text NOT NULL,
	`person_id` text NOT NULL,
	`custodian_user_id` text NOT NULL,
	`status` text NOT NULL,
	`basis` text NOT NULL,
	`verification_status` text NOT NULL,
	`valid_from` integer,
	`valid_until` integer,
	`created_by_user_id` text NOT NULL,
	`ended_by_user_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`custodian_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`ended_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`space_id`,`person_id`) REFERENCES `people`(`space_id`,`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "custodianships_interval_ck" CHECK("custodianships"."valid_until" is null or ("custodianships"."valid_from" is not null and "custodianships"."valid_until" > "custodianships"."valid_from")),
	CONSTRAINT "custodianships_active_dates_ck" CHECK("custodianships"."status" <> 'active' or "custodianships"."valid_from" is not null)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `custodianships_current_user_person_uq` ON `custodianships` (`person_id`,`custodian_user_id`) WHERE "custodianships"."status" in ('proposed', 'pending_verification', 'active', 'suspended', 'contested') and "custodianships"."valid_until" is null;--> statement-breakpoint
CREATE INDEX `custodianships_custodian_person_idx` ON `custodianships` (`custodian_user_id`,`person_id`);--> statement-breakpoint
CREATE TABLE `family_spaces` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`created_by_user_id` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE TABLE `media_assets` (
	`id` text PRIMARY KEY NOT NULL,
	`space_id` text NOT NULL,
	`person_id` text NOT NULL,
	`story_id` text,
	`r2_key` text NOT NULL,
	`kind` text NOT NULL,
	`canonical_mime` text NOT NULL,
	`byte_size` integer NOT NULL,
	`caption` text DEFAULT '' NOT NULL,
	`status` text NOT NULL,
	`created_by_user_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`ready_at` integer,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`space_id`,`person_id`) REFERENCES `people`(`space_id`,`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`space_id`,`person_id`,`story_id`) REFERENCES `stories`(`space_id`,`person_id`,`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "media_assets_byte_size_ck" CHECK("media_assets"."byte_size" > 0),
	CONSTRAINT "media_assets_ready_at_ck" CHECK(("media_assets"."status" = 'ready' and "media_assets"."ready_at" is not null) or ("media_assets"."status" <> 'ready' and "media_assets"."ready_at" is null))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `media_assets_r2_key_uq` ON `media_assets` (`r2_key`);--> statement-breakpoint
CREATE INDEX `media_assets_person_status_created_idx` ON `media_assets` (`person_id`,`status`,`created_at`);--> statement-breakpoint
CREATE TABLE `people` (
	`id` text PRIMARY KEY NOT NULL,
	`space_id` text NOT NULL,
	`display_name` text NOT NULL,
	`birth_date` text,
	`birth_date_accuracy` text DEFAULT 'unknown' NOT NULL,
	`created_by_user_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`space_id`) REFERENCES `family_spaces`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "people_birth_date_shape_ck" CHECK("people"."birth_date" is null or length("people"."birth_date") = 10),
	CONSTRAINT "people_birth_date_accuracy_ck" CHECK(("people"."birth_date" is null and "people"."birth_date_accuracy" = 'unknown') or "people"."birth_date" is not null)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `people_space_id_id_uq` ON `people` (`space_id`,`id`);--> statement-breakpoint
CREATE INDEX `people_space_created_at_idx` ON `people` (`space_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `person_account_links` (
	`id` text PRIMARY KEY NOT NULL,
	`space_id` text NOT NULL,
	`person_id` text NOT NULL,
	`user_id` text NOT NULL,
	`claim_status` text NOT NULL,
	`valid_from` integer,
	`valid_until` integer,
	`verified_at` integer,
	`verified_by_user_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`verified_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`space_id`,`person_id`) REFERENCES `people`(`space_id`,`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "person_account_links_interval_ck" CHECK("person_account_links"."valid_until" is null or ("person_account_links"."valid_from" is not null and "person_account_links"."valid_until" > "person_account_links"."valid_from")),
	CONSTRAINT "person_account_links_verified_ck" CHECK("person_account_links"."claim_status" <> 'verified' or ("person_account_links"."verified_at" is not null and "person_account_links"."valid_from" is not null))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `person_account_links_current_person_uq` ON `person_account_links` (`person_id`) WHERE "person_account_links"."claim_status" = 'verified' and "person_account_links"."valid_until" is null;--> statement-breakpoint
CREATE UNIQUE INDEX `person_account_links_current_user_space_uq` ON `person_account_links` (`space_id`,`user_id`) WHERE "person_account_links"."claim_status" = 'verified' and "person_account_links"."valid_until" is null;--> statement-breakpoint
CREATE INDEX `person_account_links_user_status_idx` ON `person_account_links` (`user_id`,`claim_status`);--> statement-breakpoint
CREATE TABLE `person_authorities` (
	`id` text PRIMARY KEY NOT NULL,
	`space_id` text NOT NULL,
	`person_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role` text NOT NULL,
	`starts_at` integer NOT NULL,
	`ends_at` integer,
	`granted_by_user_id` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`granted_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`space_id`,`person_id`) REFERENCES `people`(`space_id`,`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "person_authorities_interval_ck" CHECK("person_authorities"."ends_at" is null or "person_authorities"."ends_at" > "person_authorities"."starts_at")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `person_authorities_active_user_role_uq` ON `person_authorities` (`person_id`,`user_id`,`role`) WHERE "person_authorities"."ends_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX `person_authorities_active_self_uq` ON `person_authorities` (`person_id`) WHERE "person_authorities"."role" = 'self' and "person_authorities"."ends_at" is null;--> statement-breakpoint
CREATE INDEX `person_authorities_user_person_idx` ON `person_authorities` (`user_id`,`person_id`);--> statement-breakpoint
CREATE TABLE `relationships` (
	`id` text PRIMARY KEY NOT NULL,
	`space_id` text NOT NULL,
	`source_person_id` text NOT NULL,
	`target_person_id` text NOT NULL,
	`relationship_type` text NOT NULL,
	`evidence_mode` text NOT NULL,
	`created_by_user_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`ended_at` integer,
	`ended_by_user_id` text,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`ended_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`space_id`,`source_person_id`) REFERENCES `people`(`space_id`,`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`space_id`,`target_person_id`) REFERENCES `people`(`space_id`,`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "relationships_distinct_people_ck" CHECK("relationships"."source_person_id" <> "relationships"."target_person_id"),
	CONSTRAINT "relationships_ended_by_ck" CHECK(("relationships"."ended_at" is null and "relationships"."ended_by_user_id" is null) or ("relationships"."ended_at" is not null and "relationships"."ended_by_user_id" is not null))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `relationships_active_pair_type_uq` ON `relationships` (`space_id`,`relationship_type`,`source_person_id`,`target_person_id`) WHERE "relationships"."ended_at" is null;--> statement-breakpoint
CREATE INDEX `relationships_source_active_idx` ON `relationships` (`source_person_id`,`ended_at`);--> statement-breakpoint
CREATE INDEX `relationships_target_active_idx` ON `relationships` (`target_person_id`,`ended_at`);--> statement-breakpoint
CREATE TABLE `share_grants` (
	`id` text PRIMARY KEY NOT NULL,
	`space_id` text NOT NULL,
	`share_set_id` text NOT NULL,
	`grantee_user_id` text NOT NULL,
	`permission` text NOT NULL,
	`granted_by_user_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`revoked_at` integer,
	`revoked_by_user_id` text,
	FOREIGN KEY (`grantee_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`granted_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`revoked_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`space_id`,`share_set_id`) REFERENCES `share_sets`(`space_id`,`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "share_grants_revocation_ck" CHECK(("share_grants"."revoked_at" is null and "share_grants"."revoked_by_user_id" is null) or ("share_grants"."revoked_at" > "share_grants"."created_at" and "share_grants"."revoked_by_user_id" is not null))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `share_grants_active_grantee_uq` ON `share_grants` (`share_set_id`,`grantee_user_id`) WHERE "share_grants"."revoked_at" is null;--> statement-breakpoint
CREATE INDEX `share_grants_grantee_set_idx` ON `share_grants` (`grantee_user_id`,`share_set_id`);--> statement-breakpoint
CREATE TABLE `share_set_people` (
	`id` text PRIMARY KEY NOT NULL,
	`space_id` text NOT NULL,
	`share_set_id` text NOT NULL,
	`person_id` text NOT NULL,
	`added_by_user_id` text NOT NULL,
	`added_at` integer NOT NULL,
	`removed_at` integer,
	`removed_by_user_id` text,
	FOREIGN KEY (`added_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`removed_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`space_id`,`share_set_id`) REFERENCES `share_sets`(`space_id`,`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`space_id`,`person_id`) REFERENCES `people`(`space_id`,`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "share_set_people_removal_ck" CHECK(("share_set_people"."removed_at" is null and "share_set_people"."removed_by_user_id" is null) or ("share_set_people"."removed_at" > "share_set_people"."added_at" and "share_set_people"."removed_by_user_id" is not null))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `share_set_people_active_member_uq` ON `share_set_people` (`share_set_id`,`person_id`) WHERE "share_set_people"."removed_at" is null;--> statement-breakpoint
CREATE INDEX `share_set_people_person_set_idx` ON `share_set_people` (`person_id`,`share_set_id`);--> statement-breakpoint
CREATE TABLE `share_sets` (
	`id` text PRIMARY KEY NOT NULL,
	`space_id` text NOT NULL,
	`kind` text NOT NULL,
	`label` text NOT NULL,
	`created_by_user_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`revoked_at` integer,
	FOREIGN KEY (`space_id`) REFERENCES `family_spaces`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `share_sets_space_id_id_uq` ON `share_sets` (`space_id`,`id`);--> statement-breakpoint
CREATE INDEX `share_sets_space_active_idx` ON `share_sets` (`space_id`,`revoked_at`);--> statement-breakpoint
CREATE TABLE `space_memberships` (
	`space_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role` text NOT NULL,
	`status` text NOT NULL,
	`joined_at` integer NOT NULL,
	PRIMARY KEY(`space_id`, `user_id`),
	FOREIGN KEY (`space_id`) REFERENCES `family_spaces`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `space_memberships_user_status_idx` ON `space_memberships` (`user_id`,`status`);--> statement-breakpoint
CREATE TABLE `stories` (
	`id` text PRIMARY KEY NOT NULL,
	`space_id` text NOT NULL,
	`person_id` text NOT NULL,
	`body` text NOT NULL,
	`created_by_user_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`space_id`,`person_id`) REFERENCES `people`(`space_id`,`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "stories_body_length_ck" CHECK(length(trim("stories"."body")) between 1 and 4000)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `stories_space_person_id_uq` ON `stories` (`space_id`,`person_id`,`id`);--> statement-breakpoint
CREATE INDEX `stories_person_created_at_idx` ON `stories` (`person_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `transfer_cases` (
	`id` text PRIMARY KEY NOT NULL,
	`space_id` text NOT NULL,
	`person_id` text NOT NULL,
	`target_user_id` text,
	`status` text NOT NULL,
	`eligibility_civil_date` text,
	`eligibility_at` integer,
	`eligibility_time_zone` text,
	`policy_version` text,
	`no_account_policy` text,
	`policy_blocked_reason` text,
	`created_by_user_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`completed_at` integer,
	`completion_audit_event_id` text,
	FOREIGN KEY (`target_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`completion_audit_event_id`) REFERENCES `audit_events`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`space_id`,`person_id`) REFERENCES `people`(`space_id`,`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "transfer_cases_completion_ck" CHECK(("transfer_cases"."status" = 'completed' and "transfer_cases"."completed_at" is not null and "transfer_cases"."completion_audit_event_id" is not null) or ("transfer_cases"."status" <> 'completed' and "transfer_cases"."completed_at" is null and "transfer_cases"."completion_audit_event_id" is null)),
	CONSTRAINT "transfer_cases_policy_block_ck" CHECK("transfer_cases"."status" <> 'policy_blocked' or "transfer_cases"."policy_blocked_reason" is not null)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `transfer_cases_completion_audit_event_id_unique` ON `transfer_cases` (`completion_audit_event_id`);--> statement-breakpoint
CREATE INDEX `transfer_cases_person_status_idx` ON `transfer_cases` (`person_id`,`status`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`auth_subject` text NOT NULL,
	`email_display` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_auth_subject_uq` ON `users` (`auth_subject`);