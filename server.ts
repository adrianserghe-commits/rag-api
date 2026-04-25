import express from 'express';
import { errorHandler } from './middleware/error';
import queryRoutes from './routes/query';
import ingestRoutes from './routes/ingest';
import namespaceRoutes from './routes/namespace';
import healthRoutes from './routes/health';

const app = express();

app.use(express.json());

app.use('/v1/query', queryRoutes);
app.use('/v1/ingest', ingestRoutes);
app.use('/v1/namespaces', namespaceRoutes);
app.use('/v1/health', healthRoutes);

app.use(errorHandler);

const PORT = (globalThis as any).process?.env?.PORT || 8080;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

export default app;
