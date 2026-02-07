// api/convert.js
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: '只支持POST请求' });
  
  try {
    const { text, style = 'trendy' } = req.body;
    
    if (!text || text.trim().length === 0) {
      return res.status(400).json({ error: '请输入内容' });
    }
    
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: '服务器配置错误' });
    }
    
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'gpt-3.5-turbo',
        messages: [
          {
            role: 'system',
            content: '你是小红书文案专家，擅长将内容转换成受欢迎的小红书风格。使用亲切语气，添加表情符号和话题标签。'
          },
          {
            role: 'user',
            content: `请将以下内容转换成小红书风格（${style}）：\n\n${text}`
          }
        ],
        temperature: 0.7,
        max_tokens: 800
      })
    });
    
    if (!response.ok) {
      const error = await response.json();
      return res.status(500).json({ error: 'AI服务错误' });
    }
    
    const data = await response.json();
    const convertedText = data.choices[0]?.message?.content || '转换失败';
    
    res.status(200).json({
      success: true,
      convertedText: convertedText
    });
    
  } catch (error) {
    res.status(500).json({ error: '服务器错误', message: error.message });
  }
}
