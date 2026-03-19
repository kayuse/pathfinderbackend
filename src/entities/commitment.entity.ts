import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  OneToMany,
  JoinColumn,
} from 'typeorm';
import { Session } from './session.entity';
import { CommitmentLog } from './commitment-log.entity';

export enum Frequency {
  DAILY = 'DAILY',
  WEEKLY = 'WEEKLY',
  MONTHLY = 'MONTHLY',
  CUSTOM = 'CUSTOM',
}

@Entity('commitments')
export class Commitment {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  title: string;

  @Column({ nullable: true })
  description: string;

  @Column({ type: 'enum', enum: Frequency })
  frequency: Frequency;

  @Column({ type: 'float', nullable: true })
  targetValue: number;

  @Column()
  sessionId: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @ManyToOne(() => Session, (session) => session.commitments, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'sessionId' })
  session: Session;

  @OneToMany(() => CommitmentLog, (log: CommitmentLog) => log.commitment)
  logs: CommitmentLog[];
}
