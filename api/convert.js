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

    // 关键修改1：现在读取DeepSeek的密钥
    const apiKey = process.env.DEEPSEEK_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: '服务器配置错误: 未找到DEEPSEEK_API_KEY' });
    }

    // 关键修改2：请求URL和格式改为DeepSeek API
    const response = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'deepseek-chat', // DeepSeek的模型
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
    // 关键修改3：解析DeepSeek API的返回结果 (格式与OpenAI类似)
    const convertedText = data.choices[0]?.message?.content || '转换失败，未获得有效回复。';

    res.status(200).json({
      success: true,
      convertedText: convertedText
    });

  } catch (error) {
    res.status(500).json({ error: '服务器错误', message: error.message });
  }
}
