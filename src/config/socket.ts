import { Server as HttpServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';

let io: SocketIOServer | null = null;

export const initializeSocket = (server: HttpServer) => {
  // CORS configuration - supports multiple origins
  const corsOrigin = process.env.SOCKET_IO_CORS_ORIGIN || process.env.CORS_ORIGIN 
    ? (process.env.SOCKET_IO_CORS_ORIGIN || process.env.CORS_ORIGIN)!.split(',').map(origin => origin.trim())
    : 'http://localhost:3000';

  io = new SocketIOServer(server, {
    cors: {
      origin: corsOrigin,
      methods: ['GET', 'POST'],
      credentials: true
    }
  });

  io.on('connection', (socket) => {
    console.log(`[Socket.io] Client connected: ${socket.id}`);

    // Join room for specific organization
    socket.on('join-organization', (organizationId: string) => {
      socket.join(`org:${organizationId}`);
      console.log(`[Socket.io] Client joined organization: ${organizationId}`);
    });

    // Join room for specific conversation
    socket.on('join-conversation', (conversationId: string) => {
      socket.join(`conversation:${conversationId}`);
      console.log(`[Socket.io] Client joined conversation: ${conversationId}`);
    });

    socket.on('disconnect', () => {
      console.log(`[Socket.io] Client disconnected: ${socket.id}`);
    });
  });

  console.log('[Socket.io] Initialized successfully');
  return io;
};

export const getIO = (): SocketIOServer => {
  if (!io) {
    throw new Error('Socket.io not initialized. Call initializeSocket first.');
  }
  return io;
};

// Helper functions for emitting events
export const emitToOrganization = (organizationId: string, event: string, data: any) => {
  if (io) {
    io.to(`org:${organizationId}`).emit(event, data);
    console.log(`[Socket.io] Emitted '${event}' to organization ${organizationId}`);
  }
};

export const emitToConversation = (conversationId: string, event: string, data: any) => {
  if (io) {
    io.to(`conversation:${conversationId}`).emit(event, data);
    console.log(`[Socket.io] Emitted '${event}' to conversation ${conversationId}`);
  }
};

