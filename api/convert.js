// api/convert.js
const { createClient } = require('@supabase/supabase-js')

// 初始化 Supabase 客户端（服务端）
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY // ⚠️ 重要：使用服务端密钥
)

export default async function handler(req, res) {
  // 设置 CORS 头
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  // 处理 OPTIONS 请求
  if (req.method === 'OPTIONS') return res.status(200).end();
  
  // 只接受 POST 请求
  if (req.method !== 'POST') {
    return res.status(405).json({ error: '只支持POST请求' });
  }

  try {
    // ==================== 用户认证检查 ====================
    // 1. 检查 Authorization header
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ 
        success: false,
        error: '请先登录',
        code: 'AUTH_REQUIRED'
      });
    }

    const token = authHeader.replace('Bearer ', '');
    
    // 2. 验证用户token
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      console.error('用户认证失败:', authError?.message || '用户不存在');
      return res.status(401).json({ 
        success: false,
        error: '登录已过期，请重新登录',
        code: 'INVALID_TOKEN'
      });
    }

    console.log('用户认证成功:', user.email, 'ID:', user.id.substring(0, 8));

    // 3. 检查用户剩余次数
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('daily_quota_remaining, total_used')
      .eq('id', user.id)
      .single();

    if (profileError) {
      console.error('获取用户信息失败:', profileError);
      
      // 如果profile不存在，尝试创建
      if (profileError.code === 'PGRST116') {
        console.log('用户profile不存在，尝试创建...');
        const { error: createError } = await supabase
          .from('profiles')
          .upsert({
            id: user.id,
            email: user.email,
            daily_quota_remaining: 5,
            total_quota_purchased: 0,
            total_used: 0,
            role: 'user',
            updated_at: new Date().toISOString()
          });

        if (createError) {
          return res.status(500).json({ 
            success: false,
            error: '用户信息初始化失败',
            code: 'PROFILE_CREATE_FAILED'
          });
        }
        
        // 重新获取profile
        const { data: newProfile } = await supabase
          .from('profiles')
          .select('daily_quota_remaining')
          .eq('id', user.id)
          .single();
          
        if (!newProfile || newProfile.daily_quota_remaining <= 0) {
          return res.status(403).json({ 
            success: false,
            error: '今日免费次数已用完，请兑换卡密',
            code: 'QUOTA_EXHAUSTED',
            remaining: 0
          });
        }
        
        // 使用新创建的profile
        var userProfile = newProfile;
      } else {
        return res.status(500).json({ 
          success: false,
          error: '获取用户信息失败',
          code: 'PROFILE_FETCH_FAILED'
        });
      }
    } else if (!profile) {
      return res.status(404).json({ 
        success: false,
        error: '用户信息不存在',
        code: 'PROFILE_NOT_FOUND'
      });
    } else {
      var userProfile = profile;
    }

    // 检查剩余次数
    const remainingQuota = userProfile.daily_quota_remaining || 0;
    if (remainingQuota <= 0) {
      return res.status(403).json({ 
        success: false,
        error: '今日免费次数已用完，请兑换卡密',
        code: 'QUOTA_EXHAUSTED',
        remaining: 0
      });
    }

    console.log('用户剩余次数:', remainingQuota, '总使用次数:', userProfile.total_used || 0);

    // ==================== 处理请求数据 ====================
    const { text, style = 'trendy' } = req.body;

    if (!text || text.trim().length === 0) {
      return res.status(400).json({ 
        success: false,
        error: '请输入内容',
        code: 'EMPTY_INPUT'
      });
    }

    if (text.trim().length < 5) {
      return res.status(400).json({ 
        success: false,
        error: '内容太短，请输入至少5个字符',
        code: 'INPUT_TOO_SHORT'
      });
    }

    // 检查 DeepSeek API 密钥
    const apiKey = process.env.DEEPSEEK_API_KEY;
    if (!apiKey) {
      console.error('DeepSeek API 密钥未配置');
      return res.status(500).json({ 
        success: false,
        error: '服务器配置错误: 未找到DEEPSEEK_API_KEY',
        code: 'API_KEY_MISSING'
      });
    }

    console.log('开始调用 DeepSeek API，用户:', user.email, '文本长度:', text.length);

    // ==================== 调用 DeepSeek API ====================
    const response = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: [
          {
            role: 'system',
            content: '你是小红书文案专家，擅长将内容转换成受欢迎的小红书风格。使用亲切语气，添加表情符号和话题标签。使用中文回复。'
          },
          {
            role: 'user',
            content: `请将以下内容转换成小红书风格（${style}），要求：\n1. 使用亲切自然的语气\n2. 添加合适的表情符号\n3. 在结尾添加相关话题标签\n4. 保持原意但优化表达\n\n原文：\n${text}`
          }
        ],
        temperature: 0.7,
        max_tokens: 1000,
        stream: false
      }),
      timeout: 30000 // 30秒超时
    });

    if (!response.ok) {
      let errorMessage = 'AI服务错误';
      let errorCode = 'AI_SERVICE_ERROR';
      
      try {
        const errorData = await response.json();
        errorMessage = errorData.error?.message || JSON.stringify(errorData) || `HTTP ${response.status}`;
        
        // 分类错误
        if (response.status === 429) {
          errorMessage = 'AI服务请求过于频繁，请稍后重试';
          errorCode = 'RATE_LIMITED';
        } else if (response.status === 401) {
          errorMessage = 'AI服务认证失败';
          errorCode = 'AI_AUTH_FAILED';
        }
      } catch (e) {
        errorMessage = `HTTP ${response.status}`;
      }
      
      console.error('DeepSeek API 错误:', errorMessage);
      return res.status(500).json({ 
        success: false,
        error: errorMessage,
        code: errorCode
      });
    }

    const data = await response.json();
    const convertedText = data.choices[0]?.message?.content || '转换失败，未获得有效回复。';

    console.log('DeepSeek API 调用成功，结果长度:', convertedText.length);

    // ==================== 更新用户次数和记录日志 ====================
    try {
      // 1. 减少用户剩余次数
      const newRemaining = remainingQuota - 1;
      const { error: updateError } = await supabase
        .from('profiles')
        .update({
          daily_quota_remaining: newRemaining,
          updated_at: new Date().toISOString()
        })
        .eq('id', user.id);

      if (updateError) {
        console.error('更新用户次数失败:', updateError);
        // 继续执行，不中断返回结果
      }

      // 2. 记录使用日志（触发器会自动更新 total_used）
      const { error: logError } = await supabase
        .from('usage_logs')
        .insert({
          user_id: user.id,
          input_text: text.substring(0, 5000), // 限制长度
          output_text: convertedText.substring(0, 10000),
          metadata: {
            style: style,
            input_length: text.length,
            output_length: convertedText.length,
            model: 'deepseek-chat'
          }
        });

      if (logError) {
        console.error('记录使用日志失败:', logError);
      }

      console.log('用户次数更新成功，剩余:', newRemaining, '日志已记录');

    } catch (dbError) {
      console.error('数据库操作失败:', dbError);
      // 数据库错误不影响返回转换结果
    }

    // ==================== 返回成功结果 ====================
    res.status(200).json({
      success: true,
      convertedText: convertedText,
      remaining: remainingQuota - 1,
      user: {
        email: user.email,
        id: user.id.substring(0, 8) + '...' // 只返回部分ID
      },
      usage: {
        inputLength: text.length,
        outputLength: convertedText.length
      }
    });

  } catch (error) {
    console.error('API处理异常:', error);
    
    // 分类错误处理
    let errorCode = 'UNKNOWN_ERROR';
    let errorMessage = error.message;
    let statusCode = 500;

    if (error.name === 'FetchError' || error.message.includes('fetch')) {
      errorCode = 'NETWORK_ERROR';
      errorMessage = '网络请求失败，请检查网络连接';
    } else if (error.message.includes('timeout')) {
      errorCode = 'TIMEOUT';
      errorMessage = '请求超时，请稍后重试';
    } else if (error.message.includes('JSON')) {
      errorCode = 'PARSE_ERROR';
      errorMessage = '数据解析错误';
    }

    res.status(statusCode).json({
      success: false,
      error: errorMessage,
      code: errorCode,
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
}
