/**
 * 阿里云短信发送模块（官方 dysmsapi）
 *
 * 所需环境变量：
 *   ALIYUN_ACCESS_KEY_ID      - 阿里云 AccessKey ID
 *   ALIYUN_ACCESS_KEY_SECRET  - 阿里云 AccessKey Secret
 *   ALIYUN_SMS_SIGN_NAME      - 短信签名名称（需在阿里云控制台审批）
 *   ALIYUN_SMS_TPL_CUSTOMER   - 客户确认模板 CODE
 *                               模板变量：${name} ${storeName} ${storePhone}
 *   ALIYUN_SMS_TPL_STAFF      - 门店通知模板 CODE
 *                               模板变量：${name} ${phone} ${carModel} ${storeName}
 *   ALIYUN_SMS_STAFF_PHONE    - 接收通知的手机号，多个用英文逗号分隔
 */

const Core = require("@alicloud/pop-core");

function getClient() {
  const id = String(process.env.ALIYUN_ACCESS_KEY_ID || "").trim();
  const secret = String(process.env.ALIYUN_ACCESS_KEY_SECRET || "").trim();
  if (!id || !secret) return null;
  return new Core({
    accessKeyId: id,
    accessKeySecret: secret,
    endpoint: "https://dysmsapi.aliyuncs.com",
    apiVersion: "2017-05-25",
  });
}

async function sendSms(client, phoneNumbers, templateCode, templateParam) {
  const signName = String(process.env.ALIYUN_SMS_SIGN_NAME || "").trim();
  if (!signName || !templateCode) return;

  const params = {
    PhoneNumbers: phoneNumbers,
    SignName: signName,
    TemplateCode: templateCode,
    TemplateParam: JSON.stringify(templateParam),
  };

  const result = await client.request("SendSms", params, { method: "POST" });
  if (result.Code !== "OK") {
    console.warn(`[sms] 发送失败 ${phoneNumbers}: ${result.Code} ${result.Message}`);
  } else {
    console.log(`[sms] 发送成功 ${phoneNumbers}`);
  }
}

/**
 * @param {{ name: string, phone: string, carModel: string, storeName: string|null, storePhone: string|null }} opts
 */
async function sendTestDriveNotifications({ name, phone, carModel, storeName, storePhone }) {
  const client = getClient();
  if (!client) return; // 未配置 AccessKey，静默跳过

  const customerTpl = String(process.env.ALIYUN_SMS_TPL_CUSTOMER || "").trim();
  const staffTpl = String(process.env.ALIYUN_SMS_TPL_STAFF || "").trim();
  const staffPhones = String(process.env.ALIYUN_SMS_STAFF_PHONE || "")
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);

  // 1. 客户确认短信
  if (customerTpl && phone) {
    try {
      await sendSms(client, phone, customerTpl, {
        name: name || "顾客",
        storeName: storeName || "待确认",
        storePhone: storePhone || "请关注官方通知",
      });
    } catch (err) {
      console.warn("[sms] 客户短信异常:", err.message);
    }
  }

  // 2. 门店/销售通知短信
  if (staffTpl && staffPhones.length) {
    for (const staffPhone of staffPhones) {
      try {
        await sendSms(client, staffPhone, staffTpl, {
          name: name || "顾客",
          phone: phone || "未知",
          carModel: carModel || "未指定",
          storeName: storeName || "待确认",
        });
      } catch (err) {
        console.warn("[sms] 门店短信异常:", err.message);
      }
    }
  }
}

module.exports = { sendTestDriveNotifications };
