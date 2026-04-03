import 'dotenv/config';
import { DataSource } from 'typeorm';
import { CommitmentLog } from '../entities/commitment-log.entity.js';
import { Commitment } from '../entities/commitment.entity.js';
import { SessionParticipant } from '../entities/session-participant.entity.js';
import { Session } from '../entities/session.entity.js';
import { User } from '../entities/user.entity.js';

const isProduction = process.env.NODE_ENV === 'production';

export default new DataSource({
  type: 'postgres',
  url: process.env.DATABASE_URL,
  entities: [User, Session, Commitment, SessionParticipant, CommitmentLog],
  migrations: [isProduction ? 'dist/migrations/*.js' : 'src/migrations/*.ts'],
  synchronize: false,
  logging: false,
});
