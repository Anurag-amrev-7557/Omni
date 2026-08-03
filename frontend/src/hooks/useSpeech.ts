import { useState } from 'react';

export const useSpeech = (showToast: (msg: string) => void) => {
  const [isSpeaking, setIsSpeaking] = useState<boolean>(false);

  const speakText = (text: string) => {
    if (!('speechSynthesis' in window)) {
      showToast("Speech synthesis not supported in this browser");
      return;
    }

    if (isSpeaking) {
      window.speechSynthesis.cancel();
      setIsSpeaking(false);
      return;
    }

    const cleanText = text.replace(/\[\d+\]/g, '').replace(/[#*_`]/g, '');
    const utterance = new SpeechSynthesisUtterance(cleanText);
    utterance.rate = 1.0;
    utterance.pitch = 1.0;

    utterance.onend = () => setIsSpeaking(false);
    utterance.onerror = () => setIsSpeaking(false);

    setIsSpeaking(true);
    window.speechSynthesis.speak(utterance);
    showToast("Reading response aloud...");
  };

  const startVoiceDictation = (onTranscript: (text: string) => void) => {
    // @ts-ignore
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      showToast("Voice dictation is not supported in this browser");
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.lang = 'en-US';
    recognition.interimResults = false;

    recognition.onstart = () => {
      showToast("Listening for voice input...");
    };

    recognition.onresult = (event: any) => {
      const transcript = event.results[0][0].transcript;
      onTranscript(transcript);
      showToast("Voice captured");
    };

    recognition.onerror = () => {
      showToast("Could not recognize voice");
    };

    recognition.start();
  };

  return {
    isSpeaking,
    speakText,
    startVoiceDictation,
  };
};
