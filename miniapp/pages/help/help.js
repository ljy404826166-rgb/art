const FAQ_ITEMS = [
  {
    id: "image-loading",
    question: "为何有些作品图片加载较慢？",
    answer:
      "高清作品图片体积较大，首次打开会受到当前网络速度影响。建议切换稳定网络后重试；已经加载过的内容通常会更快显示。",
  },
  {
    id: "account-sync",
    question: "收藏、关注和浏览历史会自动同步吗？",
    answer:
      "会自动同步。同一微信账号在不同设备进入 Masterpiece 后，会自动合并收藏、关注和浏览历史，无需手动开启。",
  },
  {
    id: "profile",
    question: "如何修改头像和昵称？",
    answer:
      "进入“我的 → 个人资料”，主动选择微信头像并填写昵称后保存。浏览作品不要求必须完善个人资料。",
  },
  {
    id: "downloads",
    question: "下载的图片保存在哪里？",
    answer:
      "下载完成的图片保存在当前设备的系统相册中。清除小程序本机数据或注销账号都不会删除系统相册里的图片。",
  },
  {
    id: "content-error",
    question: "发现作品或画家信息有误怎么办？",
    answer:
      "请通过下方客服入口发送作品名称、错误内容和相关截图。信息会进入人工核查流程，经证实后我们会向您发送“博古通今”头衔以感谢您对我们的贡献。",
  },
];

Page({
  data: {
    faqs: FAQ_ITEMS.map((item) => ({
      ...item,
      expanded: false,
    })),
  },

  toggleFaq(event) {
    const id = String(
      event && event.currentTarget && event.currentTarget.dataset
        ? event.currentTarget.dataset.id || ""
        : "",
    );
    if (!id) return;
    this.setData({
      faqs: this.data.faqs.map((item) => ({
        ...item,
        expanded: item.id === id ? !item.expanded : false,
      })),
    });
  },
});

module.exports = {
  FAQ_ITEMS,
};
