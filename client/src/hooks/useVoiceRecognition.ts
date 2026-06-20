import { useState, useCallback, useRef, useEffect } from 'react';
import apiFetch from "@/lib/api";

interface VoiceRecognitionOptions {
  onResult: (text: string) => void;
  onEnd?: () => void;
  continuous?: boolean;
  interimResults?: boolean;
}

export const useVoiceRecognition = ({ onResult, onEnd, continuous = false, interimResults = false }: VoiceRecognitionOptions) => {
  const [isListening, setIsListening] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const recognitionRef = useRef<any>(null);
  
  // Use refs for callbacks to prevent re-initializing recognition on every render
  const onResultRef = useRef(onResult);
  const onEndRef = useRef(onEnd);
  
  useEffect(() => {
    onResultRef.current = onResult;
    onEndRef.current = onEnd;
  }, [onResult, onEnd]);

  useEffect(() => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (SpeechRecognition) {
      const recognition = new SpeechRecognition();
      recognition.continuous = continuous;
      recognition.interimResults = interimResults;
      recognition.lang = 'en-IN';

      recognition.onstart = () => setIsListening(true);
      recognition.onend = () => {
        setIsListening(false);
        if (onEndRef.current) onEndRef.current();
      };
      
      // Store the final accumulated transcript string
      let finalTranscript = '';
      
      recognition.onresult = async (event: any) => {
        let currentTranscript = Array.from(event.results)
          .map((result: any) => result[0])
          .map((result: any) => result.transcript)
          .join('');
          
        if (!interimResults && event.results[event.results.length - 1].isFinal) {
           setIsProcessing(true);
           try {
             const res = await apiFetch('/api/translate-voice', {
               method: 'POST',
               headers: { 'Content-Type': 'application/json' },
               body: JSON.stringify({ text: currentTranscript })
             });
             if (res.ok) {
               const data = await res.json();
               currentTranscript = data.translatedText || currentTranscript;
             }
           } catch (err) {
             console.error("Translation API failed:", err);
           } finally {
             setIsProcessing(false);
           }
        }
        
        if (onResultRef.current) onResultRef.current(currentTranscript);
      };

      recognition.onerror = (event: any) => {
        console.error('Speech recognition error:', event.error);
        setIsListening(false);
      };

      recognitionRef.current = recognition;
    }

    return () => {
      if (recognitionRef.current) {
        recognitionRef.current.stop();
      }
    };
  }, [continuous, interimResults]);

  const startListening = useCallback(() => {
    if (recognitionRef.current) {
      try {
        recognitionRef.current.start();
      } catch (e) {
        console.error('Speech recognition error:', e);
        // If already started, just ignore or stop first
        try { recognitionRef.current.stop(); } catch(err) {}
      }
    } else {
      alert('Speech Recognition is not supported in this browser. Please use Chrome.');
    }
  }, []);

  const stopListening = useCallback(() => {
    if (recognitionRef.current) {
      recognitionRef.current.stop();
    }
  }, []);

  return { isListening, isProcessing, startListening, stopListening, isSupported: !!((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition) };
};
