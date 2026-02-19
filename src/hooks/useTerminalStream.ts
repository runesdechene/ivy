'use client';

import { useCallback } from 'react';
import { useTerminal, TerminalAction } from '@/contexts/TerminalContext';

export function useTerminalStream() {
  const terminal = useTerminal();

  const streamFromUrl = useCallback(async (
    url: string,
    options?: {
      title?: string;
      onComplete?: (data?: Record<string, unknown>) => void;
      actions?: TerminalAction[];
      noStartSync?: boolean;
      noEndSync?: boolean;
    }
  ) => {
    if (!options?.noStartSync) {
      terminal.startSync(options?.title || 'Synchronisation');
    }

    try {
      const response = await fetch(url);

      if (!response.body) {
        terminal.log('❌ Erreur: Pas de réponse du serveur', 'error');
        if (!options?.noEndSync) terminal.endSync();
        return false;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        // Append decoded chunk to buffer (stream: true handles multi-byte chars)
        buffer += decoder.decode(value, { stream: true });

        // Process complete SSE messages (separated by double newline)
        const parts = buffer.split('\n\n');
        // Keep the last part as it may be incomplete
        buffer = parts.pop() || '';

        for (const part of parts) {
          const lines = part.split('\n');
          for (const line of lines) {
            // Skip SSE comments (keepalive) and empty lines
            if (!line.startsWith('data: ')) continue;

            try {
              const data = JSON.parse(line.slice(6));
              if (data.message === 'DONE') {
                if (!options?.noEndSync) {
                  terminal.endSync(options?.actions);
                }
                options?.onComplete?.(data);
                return true;
              } else if (data.message) {
                terminal.log(data.message, data.type || 'info');
              }
            } catch (e) {
              // Ignore parse errors for malformed JSON
            }
          }
        }
      }

      // Process any remaining buffer
      if (buffer.trim()) {
        const lines = buffer.split('\n');
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const data = JSON.parse(line.slice(6));
            if (data.message === 'DONE') {
              if (!options?.noEndSync) {
                terminal.endSync(options?.actions);
              }
              options?.onComplete?.(data);
              return true;
            } else if (data.message) {
              terminal.log(data.message, data.type || 'info');
            }
          } catch (e) {
            // Ignore
          }
        }
      }

      if (!options?.noEndSync) {
        terminal.endSync(options?.actions);
      }
      options?.onComplete?.();
      return true;
    } catch (err) {
      terminal.log(`❌ Erreur: ${err}`, 'error');
      if (!options?.noEndSync) terminal.endSync();
      return false;
    }
  }, [terminal]);

  return {
    ...terminal,
    streamFromUrl,
  };
}
