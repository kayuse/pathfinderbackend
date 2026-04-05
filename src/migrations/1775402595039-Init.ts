import { MigrationInterface, QueryRunner } from "typeorm";

export class Init1775402595039 implements MigrationInterface {
    name = 'Init1775402595039'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TYPE "public"."users_role_enum" AS ENUM('USER', 'ADMIN')`);
        await queryRunner.query(`CREATE TABLE "users" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "email" character varying, "name" character varying, "telegramId" character varying, "telegramUsername" character varying, "phoneNumber" character varying, "passwordHash" character varying, "role" "public"."users_role_enum" NOT NULL DEFAULT 'USER', "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_97672ac88f789774dd47f7c8be3" UNIQUE ("email"), CONSTRAINT "UQ_df18d17f84763558ac84192c754" UNIQUE ("telegramId"), CONSTRAINT "PK_a3ffb1c0c8416b9fc6f907b7433" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "session_participants" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "userId" uuid NOT NULL, "sessionId" uuid NOT NULL, "joinedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_ac3fe05fedd83b14e7d7f7a0577" UNIQUE ("userId", "sessionId"), CONSTRAINT "PK_f186de01f7f809e45eaa9bd5b84" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "sessions" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "name" character varying NOT NULL, "spiritualFocus" character varying, "description" character varying, "openForApplication" boolean NOT NULL DEFAULT true, "isClosed" boolean NOT NULL DEFAULT false, "startDate" TIMESTAMP NOT NULL, "endDate" TIMESTAMP NOT NULL, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_3238ef96f18b355b671619111bc" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TYPE "public"."commitments_frequency_enum" AS ENUM('DAILY', 'WEEKLY', 'MONTHLY', 'CUSTOM')`);
        await queryRunner.query(`CREATE TABLE "commitments" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "title" character varying NOT NULL, "description" character varying, "frequency" "public"."commitments_frequency_enum" NOT NULL, "targetValue" double precision, "sessionId" uuid NOT NULL, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_82060edcfe810ce82b7565521af" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TYPE "public"."commitment_logs_status_enum" AS ENUM('COMPLETED', 'SKIPPED', 'PENDING')`);
        await queryRunner.query(`CREATE TABLE "commitment_logs" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "date" date NOT NULL, "startDate" date, "endDate" date, "status" "public"."commitment_logs_status_enum" NOT NULL, "loggedValue" double precision, "commitmentId" uuid NOT NULL, "userId" uuid NOT NULL, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_03e3c8a873d10040650e545d2d1" UNIQUE ("userId", "commitmentId", "date"), CONSTRAINT "PK_9c61daa034c9963adb5157dd6ca" PRIMARY KEY ("id"))`);
        await queryRunner.query(`ALTER TABLE "session_participants" ADD CONSTRAINT "FK_f7e8440a17fb44d7ce9db398f85" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "session_participants" ADD CONSTRAINT "FK_405fbf7474a2df8d2131619ad1d" FOREIGN KEY ("sessionId") REFERENCES "sessions"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "commitments" ADD CONSTRAINT "FK_fc9dc2a7659bbd721b5a443c93c" FOREIGN KEY ("sessionId") REFERENCES "sessions"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "commitment_logs" ADD CONSTRAINT "FK_33c780d70182876b2c927d7b970" FOREIGN KEY ("commitmentId") REFERENCES "commitments"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "commitment_logs" ADD CONSTRAINT "FK_be06742ba5a5db9330ff771d1ea" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "commitment_logs" DROP CONSTRAINT "FK_be06742ba5a5db9330ff771d1ea"`);
        await queryRunner.query(`ALTER TABLE "commitment_logs" DROP CONSTRAINT "FK_33c780d70182876b2c927d7b970"`);
        await queryRunner.query(`ALTER TABLE "commitments" DROP CONSTRAINT "FK_fc9dc2a7659bbd721b5a443c93c"`);
        await queryRunner.query(`ALTER TABLE "session_participants" DROP CONSTRAINT "FK_405fbf7474a2df8d2131619ad1d"`);
        await queryRunner.query(`ALTER TABLE "session_participants" DROP CONSTRAINT "FK_f7e8440a17fb44d7ce9db398f85"`);
        await queryRunner.query(`DROP TABLE "commitment_logs"`);
        await queryRunner.query(`DROP TYPE "public"."commitment_logs_status_enum"`);
        await queryRunner.query(`DROP TABLE "commitments"`);
        await queryRunner.query(`DROP TYPE "public"."commitments_frequency_enum"`);
        await queryRunner.query(`DROP TABLE "sessions"`);
        await queryRunner.query(`DROP TABLE "session_participants"`);
        await queryRunner.query(`DROP TABLE "users"`);
        await queryRunner.query(`DROP TYPE "public"."users_role_enum"`);
    }

}
