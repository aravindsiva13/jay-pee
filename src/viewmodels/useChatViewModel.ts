// =============================================================================
// CHAT VIEWMODEL - Business Logic & State Management  
// =============================================================================

import { useState, useEffect, useCallback, useRef } from 'react';
import { apiService } from '../services/api';
import { mockService } from '../services/mock-service';
import { webSocketService } from '../services/websocket-service';
import {
  ChatMessage,
  AgentResponse,
  WebSocketMessage,
  ChatStatus
} from '../models/chat.types';
import { TaskAction } from '../models/task.types';
import { API_ENDPOINTS, DEFAULT_MESSAGES } from '../lib/constants';
import { generateId } from '../lib/utils';

interface ChatViewModelState {
  messages: ChatMessage[];
  isProcessing: boolean;
  connectionStatus: ChatStatus;
  error: string | null;
}

interface ChatViewModelActions {
  sendMessage: (content: string, onTaskAction?: (action: TaskAction) => void) => Promise<void>;
  clearMessages: () => void;
  clearError: () => void;
  reconnect: () => void;
}

export type ChatViewModel = ChatViewModelState & ChatViewModelActions;

export const useChatViewModel = (): ChatViewModel => {
  const [state, setState] = useState<ChatViewModelState>({
    messages: [
      {
        id: '1',
        type: 'agent',
        content: DEFAULT_MESSAGES.WELCOME,
        timestamp: new Date().toISOString()
      }
    ],
    isProcessing: false,
    connectionStatus: 'disconnected',
    error: null
  });

  const taskActionCallbackRef = useRef<((action: TaskAction) => void) | null>(null);
  const useMockData = process.env.NODE_ENV === 'development';

  // Handle WebSocket messages
  const handleWebSocketMessage = useCallback((wsMessage: WebSocketMessage) => {
    switch (wsMessage.type) {
      case 'chat':
        const { response, actions } = wsMessage.payload as AgentResponse;
        
        // Add agent response message
        const agentMessage: ChatMessage = {
          id: generateId(),
          type: 'agent',
          content: response,
          timestamp: new Date().toISOString()
        };

        setState(prev => ({
          ...prev,
          messages: [...prev.messages, agentMessage],
          isProcessing: false
        }));

        // Execute task actions if callback is available
        if (taskActionCallbackRef.current && actions && actions.length > 0) {
          actions.forEach(action => {
            if (taskActionCallbackRef.current) {
              taskActionCallbackRef.current(action);
            }
          });
        }
        break;

      case 'task_update':
        // Handle real-time task updates from server
        const taskUpdateMessage: ChatMessage = {
          id: generateId(),
          type: 'agent',
          content: `Task updated: ${wsMessage.payload.message}`,
          timestamp: new Date().toISOString()
        };

        setState(prev => ({
          ...prev,
          messages: [...prev.messages, taskUpdateMessage]
        }));
        break;

      case 'error':
        setState(prev => ({
          ...prev,
          isProcessing: false,
          error: wsMessage.payload.message || DEFAULT_MESSAGES.ERROR
        }));

        // Add error message to chat
        const errorMessage: ChatMessage = {
          id: generateId(),
          type: 'agent',
          content: wsMessage.payload.message || DEFAULT_MESSAGES.ERROR,
          timestamp: new Date().toISOString()
        };

        setState(prev => ({
          ...prev,
          messages: [...prev.messages, errorMessage]
        }));
        break;
    }
  }, []);

  // Handle WebSocket status changes
  const handleStatusChange = useCallback((status: ChatStatus) => {
    setState(prev => ({ ...prev, connectionStatus: status }));

    // Handle connection errors
    if (status === 'error' || status === 'disconnected') {
      setState(prev => ({
        ...prev,
        isProcessing: false,
        error: status === 'error' ? DEFAULT_MESSAGES.CONNECTION_ERROR : null
      }));
    }
  }, []);

  // Send message to AI agent
  const sendMessage = useCallback(async (
    content: string, 
    onTaskAction?: (action: TaskAction) => void
  ) => {
    if (!content.trim() || state.isProcessing) return;

    // Store task action callback
    taskActionCallbackRef.current = onTaskAction || null;

    // Add user message to chat
    const userMessage: ChatMessage = {
      id: generateId(),
      type: 'user',
      content: content.trim(),
      timestamp: new Date().toISOString()
    };

    setState(prev => ({
      ...prev,
      messages: [...prev.messages, userMessage],
      isProcessing: true,
      error: null
    }));

    try {
      if (useMockData) {
        // Use mock service in development
        await sendMessageViaMock(content);
      } else {
        // Try WebSocket first if connected
        if (webSocketService.isConnected()) {
          webSocketService.sendMessage(content);
        } else {
          // Fallback to REST API
          await sendMessageViaAPI(content);
        }
      }
    } catch (error) {
      console.error('Error sending message:', error);
      
      setState(prev => ({
        ...prev,
        isProcessing: false,
        error: 'Failed to send message. Please try again.'
      }));

      // Add error message to chat
      const errorMessage: ChatMessage = {
        id: generateId(),
        type: 'agent',
        content: DEFAULT_MESSAGES.ERROR,
        timestamp: new Date().toISOString()
      };

      setState(prev => ({
        ...prev,
        messages: [...prev.messages, errorMessage]
      }));
    }
  }, [state.isProcessing, useMockData]);

  // Send message via mock service
  const sendMessageViaMock = async (content: string) => {
    try {
      const response = await mockService.processAgentMessage(content);

      // Add agent response
      const agentMessage: ChatMessage = {
        id: generateId(),
        type: 'agent',
        content: response.response,
        timestamp: new Date().toISOString()
      };

      setState(prev => ({
        ...prev,
        messages: [...prev.messages, agentMessage],
        isProcessing: false
      }));

      // Execute task actions
      if (taskActionCallbackRef.current && response.actions && response.actions.length > 0) {
        response.actions.forEach(action => {
          if (taskActionCallbackRef.current) {
            taskActionCallbackRef.current(action);
          }
        });
      }
    } catch (error) {
      throw error;
    }
  };

  // Send message via REST API (fallback)
  const sendMessageViaAPI = async (content: string) => {
    try {
      const response = await apiService.post<AgentResponse>(
        API_ENDPOINTS.CHAT,
        { message: content }
      );

      // Add agent response
      const agentMessage: ChatMessage = {
        id: generateId(),
        type: 'agent',
        content: response.response,
        timestamp: new Date().toISOString()
      };

      setState(prev => ({
        ...prev,
        messages: [...prev.messages, agentMessage],
        isProcessing: false
      }));

      // Execute task actions
      if (taskActionCallbackRef.current && response.actions && response.actions.length > 0) {
        response.actions.forEach(action => {
          if (taskActionCallbackRef.current) {
            taskActionCallbackRef.current(action);
          }
        });
      }
    } catch (error) {
      throw error;
    }
  };

  // Clear all messages
  const clearMessages = useCallback(() => {
    setState(prev => ({
      ...prev,
      messages: [
        {
          id: '1',
          type: 'agent',
          content: DEFAULT_MESSAGES.WELCOME,
          timestamp: new Date().toISOString()
        }
      ],
      error: null
    }));
  }, []);

  // Clear error state
  const clearError = useCallback(() => {
    setState(prev => ({ ...prev, error: null }));
  }, []);

  // Reconnect WebSocket
  const reconnect = useCallback(() => {
    if (!useMockData) {
      webSocketService.disconnect();
      setTimeout(() => {
        webSocketService.connect();
      }, 1000);
    }
  }, [useMockData]);

  // Initialize WebSocket connection and event handlers
  useEffect(() => {
    if (!useMockData) {
      // Set up WebSocket event handlers
      const unsubscribeMessage = webSocketService.onMessage(handleWebSocketMessage);
      const unsubscribeStatus = webSocketService.onStatusChange(handleStatusChange);

      // Connect WebSocket
      webSocketService.connect();

      // Cleanup on unmount
      return () => {
        unsubscribeMessage();
        unsubscribeStatus();
        webSocketService.disconnect();
        taskActionCallbackRef.current = null;
      };
    } else {
      // Mock connected status in development
      setState(prev => ({ ...prev, connectionStatus: 'connected' }));
    }
  }, [handleWebSocketMessage, handleStatusChange, useMockData]);

  return {
    // State
    messages: state.messages,
    isProcessing: state.isProcessing,
    connectionStatus: state.connectionStatus,
    error: state.error,

    // Actions
    sendMessage,
    clearMessages,
    clearError,
    reconnect
  };
};