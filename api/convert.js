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
    
    // 关键修改1：读取Gemini的密钥
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: '服务器配置错误: 未找到GEMINI_API_KEY' });
    }
    
    // 关键修改2：请求URL和格式改为Gemini API
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        contents: [{
          parts: [{
            // 关键修改3：提示词调整为Gemini格式
            text: `你是一个小红书文案专家，擅长将内容转换成受欢迎的小红书风格。请使用亲切语气，添加表情符号和话题标签。\n\n请将以下内容转换成${style}风格的小红书文案：\n\n${text}`
          }]
        }],
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: 800,
        }
      })
    });
    
    if (!response.ok) {
      let errorMessage = 'AI服务错误';
      try {
        const errorData = await response.json();
        errorMessage = errorData.error?.message || JSON.stringify(errorData) || `HTTP ${response.status}`;
      } catch (e) {
        errorMessage = `HTTP ${response.status}`;
      }
      return res.status(500).json({ error: errorMessage });
    }
    
    const data = await response.json();
    // 关键修改4：解析Gemini API的返回结果
    const convertedText = data.candidates?.[0]?.content?.parts?.[0]?.text || '转换失败，未获得有效回复。';
    
    res.status(200).json({
      success: true,
      convertedText: convertedText
    });
    
  } catch (error) {
    res.status(500).json({ error: '服务器错误', message: error.message });
  }
}
