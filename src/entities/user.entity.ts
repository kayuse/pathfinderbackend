import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
} from 'typeorm';
import { SessionParticipant } from './session-participant.entity.js';
import { CommitmentLog } from './commitment-log.entity.js';

export enum Role {
  USER = 'USER',
  ADMIN = 'ADMIN',
}

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ nullable: true, unique: true })
  email: string;

  @Column({ nullable: true })
  name: string;

  @Column({ nullable: true, unique: true })
  telegramId: string;

  @Column({ nullable: true })
  telegramUsername: string;

  @Column({ nullable: true })
  passwordHash: string;

  @Column({ type: 'enum', enum: Role, default: Role.USER })
  role: Role;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @OneToMany(() => SessionParticipant, (sp) => sp.user)
  sessions: SessionParticipant[];

  @OneToMany(() => CommitmentLog, (log) => log.user)
  logs: CommitmentLog[];
}
