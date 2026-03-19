import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
} from 'typeorm';
import { Commitment } from './commitment.entity.js';
import { SessionParticipant } from './session-participant.entity.js';

@Entity('sessions')
export class Session {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  name: string;

  @Column({ nullable: true })
  spiritualFocus: string;

  @Column({ nullable: true })
  description: string;

  @Column({ default: true })
  openForApplication: boolean;

  @Column()
  startDate: Date;

  @Column()
  endDate: Date;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @OneToMany(() => Commitment, (commitment) => commitment.session)
  commitments: Commitment[];

  @OneToMany(() => SessionParticipant, (sp) => sp.session)
  participants: SessionParticipant[];
}
