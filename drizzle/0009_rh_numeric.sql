ALTER TABLE "rh_contract" ALTER COLUMN "fte_at_read" SET DATA TYPE numeric(14, 4);--> statement-breakpoint
ALTER TABLE "rh_contract" ALTER COLUMN "weekly_hours_at_read" SET DATA TYPE numeric(14, 4);--> statement-breakpoint
ALTER TABLE "rh_contract_month" ALTER COLUMN "reference_quota" SET DATA TYPE numeric(14, 4);--> statement-breakpoint
ALTER TABLE "rh_contract_month" ALTER COLUMN "contract_quota" SET DATA TYPE numeric(14, 4);--> statement-breakpoint
ALTER TABLE "rh_contract_month" ALTER COLUMN "paid_time" SET DATA TYPE numeric(14, 4);--> statement-breakpoint
ALTER TABLE "rh_contract_month" ALTER COLUMN "worked_time" SET DATA TYPE numeric(14, 4);