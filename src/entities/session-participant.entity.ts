import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Unique,
} from 'typeorm';
import { User } from './user.entity';
import { Session } from './session.entity';

@Entity('session_participants')
@Unique(['userId', 'sessionId'])
export class SessionParticipant {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  userId: string;

  @Column()
  sessionId: string;

  @CreateDateColumn()
  joinedAt: Date;

  @ManyToOne(() => User, (user) => user.sessions, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: User;

  @ManyToOne(() => Session, (session) => session.participants, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'sessionId' })
  session: Session;
}
