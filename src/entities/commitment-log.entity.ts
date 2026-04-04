import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Unique,
} from 'typeorm';
import { Commitment } from './commitment.entity';
import { User } from './user.entity';

export enum LogStatus {
  COMPLETED = 'COMPLETED',
  SKIPPED = 'SKIPPED',
  PENDING = 'PENDING',
}

@Entity('commitment_logs')
@Unique(['userId', 'commitmentId', 'date'])
export class CommitmentLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'date' })
  date: Date;

  @Column({ type: 'date', nullable: true })
  startDate: Date;

  @Column({ type: 'date', nullable: true })
  endDate: Date;

  @Column({ type: 'enum', enum: LogStatus })
  status: LogStatus;

  @Column({ type: 'float', nullable: true })
  loggedValue: number;

  @Column()
  commitmentId: string;

  @Column()
  userId: string;

  @CreateDateColumn()
  createdAt: Date;

  @ManyToOne(() => Commitment, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'commitmentId' })
  commitment: Commitment;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: User;
}
