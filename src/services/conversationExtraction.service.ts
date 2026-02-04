import axios from 'axios';
import Message from '../models/Message';
import Conversation from '../models/Conversation';

/**
 * Service to extract structured data from conversations using AI
 */
class ConversationExtractionService {
  
  /**
   * Extract contact information and appointment details from conversation
   */
  async extractContactData(conversationId: string): Promise<{
    name?: string;
    email?: string;
    phone?: string;
    appointmentDate?: string;
    appointmentTime?: string;
    hasAllRequiredData: boolean;
    intent?: string;
  }> {
    try {
      console.log('[Conversation Extraction] Extracting data from conversation:', conversationId);

      // Get all messages from conversation
      const messages = await Message.find({
        conversationId: conversationId
      }).sort({ timestamp: 1 }).lean();

      if (messages.length === 0) {
        return { hasAllRequiredData: false };
      }

      // Build conversation text
      const conversationText = messages.map(msg => {
        const sender = msg.sender === 'customer' ? 'User' : 'AI';
        return `${sender}: ${msg.text}`;
      }).join('\n');

      console.log('[Conversation Extraction] Conversation text:', conversationText);

      // Use AI to extract structured data
      const extractionPrompt = `You are a data extraction assistant. Extract the following information from this conversation:
- name: The person's full name
- email: Email address
- phone: Phone number (in E.164 format if possible, e.g., +1234567890)
- appointmentDate: Appointment date in YYYY-MM-DD format
- appointmentTime: Appointment time in HH:MM format (24-hour)
- intent: What the user wants to do (e.g., "book_appointment", "get_info", "general_inquiry")

Conversation:
${conversationText}

Return ONLY a valid JSON object with the extracted data. If a field is not found, omit it. Example:
{
  "name": "John Doe",
  "email": "john@example.com",
  "phone": "+1234567890",
  "appointmentDate": "2024-02-10",
  "appointmentTime": "14:00",
  "intent": "book_appointment"
}

JSON:`;

      // Call LLM for extraction
      const response = await axios.post(
        'https://api.openai.com/v1/chat/completions',
        {
          model: 'gpt-4o-mini',
          messages: [
            {
              role: 'system',
              content: 'You are a data extraction assistant. Extract structured data from conversations and return only valid JSON.'
            },
            {
              role: 'user',
              content: extractionPrompt
            }
          ],
          temperature: 0.1,
          max_tokens: 500
        },
        {
          headers: {
            'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
            'Content-Type': 'application/json'
          }
        }
      );

      const extractedText = response.data.choices[0].message.content.trim();
      console.log('[Conversation Extraction] Raw extracted text:', extractedText);

      // Parse JSON (handle markdown code blocks)
      let extractedData: any = {};
      try {
        // Remove markdown code blocks if present
        const jsonMatch = extractedText.match(/```json\s*([\s\S]*?)\s*```/) || 
                         extractedText.match(/```\s*([\s\S]*?)\s*```/) ||
                         [null, extractedText];
        const jsonText = jsonMatch[1] || extractedText;
        extractedData = JSON.parse(jsonText);
      } catch (parseError) {
        console.error('[Conversation Extraction] Failed to parse JSON:', parseError);
        extractedData = {};
      }

      // Check if we have all required data for automation
      const hasAllRequiredData = !!(
        extractedData.name &&
        extractedData.email &&
        extractedData.phone &&
        extractedData.appointmentDate &&
        extractedData.appointmentTime
      );

      console.log('[Conversation Extraction] Extracted data:', extractedData);
      console.log('[Conversation Extraction] Has all required data:', hasAllRequiredData);

      // Update conversation metadata
      await Conversation.findByIdAndUpdate(conversationId, {
        $set: {
          'metadata.extractedData': extractedData,
          'metadata.hasAllRequiredData': hasAllRequiredData,
          'metadata.lastExtractionAt': new Date()
        }
      });

      return {
        ...extractedData,
        hasAllRequiredData
      };
    } catch (error: any) {
      console.error('[Conversation Extraction] Error:', error.message);
      return { hasAllRequiredData: false };
    }
  }

  /**
   * Check if conversation has all required data for automation
   */
  async hasRequiredData(conversationId: string): Promise<boolean> {
    try {
      const conversation = await Conversation.findById(conversationId).lean();
      return conversation?.metadata?.hasAllRequiredData === true;
    } catch (error) {
      return false;
    }
  }
}

export default new ConversationExtractionService();
