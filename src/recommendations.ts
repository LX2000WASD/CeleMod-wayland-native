import type { TranslateFn } from './i18n';
import strawberryJamCover from './assets/collabs/strawberry-jam.webp';
import galleryCollabCover from './assets/collabs/gallery-collab.webp';
import springCollabCover from './assets/collabs/spring-collab.webp';
import theRoadLessTravelledCover from './assets/collabs/the-road-less-travelled.webp';
import winterCollabCover from './assets/collabs/winter-collab.svg';
import glyphCover from './assets/collabs/glyph.svg';

export type RecommendationMetric = {
  label: string;
  value: string;
};

export type RecommendedMod = {
  name: string;
  description: string;
  downloadUrl: string;
  batchInstall?: boolean;
  displayName?: string;
  alias?: string;
  highlight?: string;
  highlights?: string[];
  coverImage?: string;
  coverPosition?: string;
  metrics?: RecommendationMetric[];
};

export type RecommendationSection = {
  id: string;
  title: string;
  description: string;
  layout?: 'default' | 'maps';
  mods: RecommendedMod[];
};

export function getRecommendationSections(t: TranslateFn): RecommendationSection[] {
  return [
    {
      id: 'utility',
      title: t('常用功能模组'),
      description: t('先补一组真正提升游玩和调试效率的工具类模组。'),
      mods: [
        {
          name: 'Collab Lobby UI',
          description: t('在大地图中按 M 打开 Collab 地图选择器。'),
          downloadUrl: 'https://celeste.weg.fan/api/v2/download/mods/CollabLobbyUI',
        },
        {
          name: 'Miao.CelesteNet.Client',
          displayName: 'MiaoCelesteNet',
          description: t('中文环境常用的群服联机模组。'),
          downloadUrl: 'https://celeste.weg.fan/api/v2/download/mods/Miao.CelesteNet.Client',
        },
        {
          name: 'Extended Variant Mode',
          description: t('提供大量玩法、视觉和参数改动选项。'),
          downloadUrl: 'https://celeste.weg.fan/api/v2/download/mods/ExtendedVariantMode',
        },
        {
          name: 'Speedrun Tool',
          description: t('SL、调试地图、计时与练习工作流的核心工具。'),
          downloadUrl: 'https://celeste.weg.fan/api/v2/download/mods/SpeedrunTool',
        },
        {
          name: 'CelesteTAS',
          description: t('TAS 编写与碰撞箱、数值调试工具。'),
          downloadUrl: 'https://celeste.weg.fan/api/v2/download/mods/CelesteTAS',
        },
        {
          name: 'DeathTracker',
          description: t('实时显示死亡次数。'),
          downloadUrl: 'https://celeste.weg.fan/api/v2/download/mods/DeathTracker',
        },
        {
          name: 'Input History',
          description: t('显示输入历史，方便排查手法问题。'),
          downloadUrl: 'https://celeste.weg.fan/api/v2/download/mods/InputHistory',
        },
        {
          name: 'Stamina Meter',
          description: t('显示体力条。'),
          downloadUrl: 'https://celeste.weg.fan/api/v2/download/mods/StaminaMeter',
        },
        {
          name: 'Strawberry Tool',
          description: t('帮助观察附近收集品与草莓状态。'),
          downloadUrl: 'https://celeste.weg.fan/api/v2/download/mods/StrawberryTool',
        },
        {
          name: 'Infinite Backups',
          description: t('提供更多、更完整的存档备份。'),
          downloadUrl: 'https://celeste.weg.fan/api/v2/download/mods/InfiniteBackups',
        },
      ],
    },
    {
      id: 'visual',
      title: t('外观与演出'),
      description: t('不碰玩法，只给角色、拖尾和界面增加辨识度。'),
      mods: [
        {
          name: 'Niko - Oneshot',
          description: t('Oneshot Niko 角色皮肤。'),
          downloadUrl: 'https://celeste.weg.fan/api/v2/download/mods/Niko_-_Celeste_Skin-Helper',
        },
        {
          name: 'Hyperline',
          description: t('自定义头发颜色和长度。'),
          downloadUrl: 'https://celeste.weg.fan/api/v2/download/mods/Hyperline',
        },
        {
          name: 'Trailine',
          description: t('提供剪影拖尾效果。'),
          downloadUrl: 'https://celeste.weg.fan/api/v2/download/mods/Trailine',
        },
        {
          name: 'Bunneline',
          description: t('兔耳皮肤。'),
          downloadUrl: 'https://celeste.weg.fan/api/v2/download/mods/Bunneline',
        },
        {
          name: 'Cateline',
          description: t('猫德琳皮肤。'),
          downloadUrl: 'https://celeste.weg.fan/api/v2/download/mods/Cateline',
        },
        {
          name: 'Maddy Crown',
          description: t('金草莓皇冠皮肤。'),
          downloadUrl: 'https://celeste.weg.fan/api/v2/download/mods/MaddyCrown',
        },
        {
          name: 'uwu Kevins',
          description: t('Kevin 方块皮肤。'),
          downloadUrl: 'https://celeste.weg.fan/api/v2/download/mods/uwuKevins',
          batchInstall: false,
        },
        {
          name: 'Replace Gold Flag With Star',
          description: t('用星星替换金旗。'),
          downloadUrl: 'https://celeste.weg.fan/api/v2/download/mods/ReplaceGoldFlagWithStar',
          batchInstall: false,
        },
      ],
    },
    {
      id: 'maps',
      layout: 'maps',
      title: t('推荐地图'),
      description: t('先放最常见的大型图包和几张代表性的独立地图。'),
      mods: [
        {
          name: 'StrawberryJam2021',
          displayName: t('草莓酱'),
          alias: 'Strawberry Jam / SJ',
          description: t('体量极大的地图集，覆盖多个难度段。'),
          highlight: t('最完整、最像“Celeste 社区主入口”的大型图包之一。'),
          highlights: [
            t('大厅和地图数量都极其夸张，适合长期慢慢打。'),
            t('从 Beginner 到 Grandmaster 都有清晰梯度。'),
            t('配套教学、音乐和场景完成度都很高。'),
          ],
          coverImage: strawberryJamCover,
          coverPosition: 'center center',
          metrics: [
            { label: t('发布时间'), value: '2023-02' },
            { label: t('体量'), value: '~2 GiB' },
            { label: t('难度'), value: t('新手到 Grandmaster') },
          ],
          downloadUrl: 'https://celeste.weg.fan/api/v2/download/mods/StrawberryJam2021',
        },
        {
          name: 'ChineseNewYear2024Collab',
          displayName: t('画游'),
          alias: 'Gallery Collab / 2024 CNY',
          description: t('中国玩家制作的地图集，量不大但美术很强。'),
          highlight: t('一眼能认出来的国风美术和更浓的策展感。'),
          highlights: [
            t('大厅氛围和转场设计很强，适合想看风格化地图的人。'),
            t('覆盖多个难度层，但整体节奏比超大图包更紧凑。'),
            t('如果想先体验中文社区审美，这张图很值得先装。'),
          ],
          coverImage: galleryCollabCover,
          coverPosition: 'center center',
          metrics: [
            { label: t('发布时间'), value: '2024-03' },
            { label: t('体量'), value: '~400 MiB' },
            { label: t('难度'), value: t('进阶到高难') },
          ],
          downloadUrl: 'https://celeste.weg.fan/api/v2/download/mods/ChineseNewYear2024Collab',
        },
        {
          name: 'SpringCollab2020',
          displayName: t('春游'),
          alias: 'Spring Collab 2020',
          description: t('更偏入门的大型图包。'),
          highlight: t('老牌但仍然很稳，入门和回坑都好用。'),
          highlights: [
            t('章节结构清晰，适合作为大型图包的第一站。'),
            t('比 Strawberry Jam 更早、更朴素，但路线组织依旧扎实。'),
            t('适合想要大量社区关卡、又不想一上来就被难度劝退的人。'),
          ],
          coverImage: springCollabCover,
          coverPosition: 'center center',
          metrics: [
            { label: t('发布时间'), value: '2020-09' },
            { label: t('体量'), value: '~560 MiB' },
            { label: t('难度'), value: t('入门到高难') },
          ],
          downloadUrl: 'https://celeste.weg.fan/api/v2/download/mods/SpringCollab2020',
        },
        {
          name: 'WinterCollab2021',
          displayName: t('冬游'),
          alias: 'Winter Collab 2021',
          description: t('另一套成熟的大型图包。'),
          highlight: t('冷色氛围更重，路线和关卡体力活也更绵长。'),
          highlights: [
            t('如果你已经打过几套经典 collab，这套很适合继续往下接。'),
            t('整体气质更冷、更耐打，长线体验很好。'),
            t('适合喜欢雪景、夜色和更沉一点配色的人。'),
          ],
          coverImage: winterCollabCover,
          coverPosition: 'center center',
          metrics: [
            { label: t('发布时间'), value: '2021-12' },
            { label: t('体量'), value: '~1 GiB' },
            { label: t('难度'), value: t('进阶到专家') },
          ],
          downloadUrl: 'https://celeste.weg.fan/api/v2/download/mods/WinterCollab2021',
        },
        {
          name: 'the road less travelled',
          displayName: t('孤行路远'),
          alias: 'the road less travelled',
          description: t('节奏安静、完成度很高的独立地图。'),
          highlight: t('不是最吵的那种名作，但气氛和音乐都很稳。'),
          highlights: [
            t('适合想打一张完整单图、又不想立刻进超长图包的人。'),
            t('风景和路线都偏平和，完成后记忆点很强。'),
            t('A 面强度不算离谱，但后续内容依然有技术要求。'),
          ],
          coverImage: theRoadLessTravelledCover,
          coverPosition: 'center center',
          metrics: [
            { label: t('发布时间'), value: '2021-12' },
            { label: t('体量'), value: '~50 MiB' },
            { label: t('难度'), value: t('中阶单图') },
          ],
          downloadUrl: 'https://celeste.weg.fan/api/v2/download/mods/the%20road%20less%20travelled',
          batchInstall: false,
        },
        {
          name: 'glyph',
          displayName: 'glyph',
          alias: 'glyph',
          description: t('经典独立图，强度更高。'),
          highlight: t('老牌硬图，气质很锋利，不是休闲观光路线。'),
          highlights: [
            t('适合已经有一定 mod 图经验，想找更聚焦挑战的玩家。'),
            t('路线密度高，失误反馈直接，属于会留下肌肉记忆的图。'),
            t('如果你想从“大型合集”切回“高压单图”，可以从这里开始。'),
          ],
          coverImage: glyphCover,
          coverPosition: 'center center',
          metrics: [
            { label: t('发布时间'), value: '2019' },
            { label: t('体量'), value: '~35 MiB' },
            { label: t('难度'), value: t('高压单图') },
          ],
          downloadUrl: 'https://celeste.weg.fan/api/v2/download/mods/glyph',
          batchInstall: false,
        },
      ],
    },
  ];
}
