export const DIALECTS = {
  sixian: { name: '四縣', english: 'Sixian' },
  hailu: { name: '海陸', english: 'Hailu' },
  dapu: { name: '大埔', english: 'Dapu' },
  raoping: { name: '饒平', english: 'Raoping' },
  zhaoan: { name: '詔安', english: "Zhao'an" },
};

export const TOPICS = {
  greetings: { name: '問候', english: 'Greetings' },
  numbers: { name: '數字', english: 'Numbers' },
  family: { name: '家人', english: 'Family' },
  food: { name: '食物', english: 'Food' },
  daily: { name: '日常', english: 'Daily Phrases' },
};

export const PHRASES = [
  // === GREETINGS ===
  {
    id: 'greet-01',
    topic: 'greetings',
    characters: '你好',
    english: 'Hello',
    dialects: {
      sixian: { pfs: 'ngi2 ho3', tones: 'ngì hó' },
      hailu: { pfs: 'ngi5 ho3', tones: 'ngì hó' },
      dapu: { pfs: 'ngi2 ho3', tones: 'ngì hó' },
      raoping: { pfs: 'ngi2 ho3', tones: 'ngì hó' },
      zhaoan: { pfs: 'ngi2 ho3', tones: 'ngì hó' },
    },
  },
  {
    id: 'greet-02',
    topic: 'greetings',
    characters: '你好無？',
    english: 'How are you?',
    dialects: {
      sixian: { pfs: 'ngi2 ho3 mo2?', tones: 'ngì hó mò?' },
      hailu: { pfs: 'ngi5 ho3 mo2?', tones: 'ngì hó mò?' },
    },
  },
  {
    id: 'greet-03',
    topic: 'greetings',
    characters: '㧡好',
    english: "I'm fine / Very good",
    dialects: {
      sixian: { pfs: 'gai5 ho3', tones: 'gāi hó' },
      hailu: { pfs: 'gai1 ho3', tones: 'gāi hó' },
    },
  },
  {
    id: 'greet-04',
    topic: 'greetings',
    characters: '多謝',
    english: 'Thank you',
    dialects: {
      sixian: { pfs: 'do1 qia5', tones: 'dō qiā' },
      hailu: { pfs: 'do1 qia5', tones: 'dō qiā' },
      dapu: { pfs: 'do1 qia5', tones: 'dō qiā' },
      raoping: { pfs: 'do1 qia5', tones: 'dō qiā' },
      zhaoan: { pfs: 'do1 qia5', tones: 'dō qiā' },
    },
  },
  {
    id: 'greet-05',
    topic: 'greetings',
    characters: '毋使客氣',
    english: "You're welcome",
    dialects: {
      sixian: { pfs: 'm2 sii3 hag4 hi5', tones: 'm̀ sìi hag hī' },
      hailu: { pfs: 'm2 sii3 hag4 hi5', tones: 'm̀ sìi hag hī' },
    },
  },
  {
    id: 'greet-06',
    topic: 'greetings',
    characters: '對毋住',
    english: 'Excuse me / Sorry',
    dialects: {
      sixian: { pfs: 'dui5 m2 cu5', tones: 'duī m̀ cū' },
      hailu: { pfs: 'dui5 m2 cu5', tones: 'duī m̀ cū' },
    },
  },
  {
    id: 'greet-07',
    topic: 'greetings',
    characters: '再見',
    english: 'Goodbye',
    dialects: {
      sixian: { pfs: 'zai5 gien5', tones: 'zāi giēn' },
      hailu: { pfs: 'zai5 gien5', tones: 'zāi giēn' },
    },
  },
  {
    id: 'greet-08',
    topic: 'greetings',
    characters: '請問',
    english: 'May I ask...',
    dialects: {
      sixian: { pfs: 'qiang3 mun5', tones: 'qiáng mūn' },
      hailu: { pfs: 'qiang3 mun5', tones: 'qiáng mūn' },
    },
  },
  {
    id: 'greet-09',
    topic: 'greetings',
    characters: '食飽未？',
    english: 'Have you eaten? (common greeting)',
    dialects: {
      sixian: { pfs: 'siid8 bau3 mui5?', tones: 'siid bàu mūi?' },
      hailu: { pfs: 'siid8 bau3 mui5?', tones: 'siid bàu mūi?' },
    },
  },
  {
    id: 'greet-10',
    topic: 'greetings',
    characters: '食飽了',
    english: "I've eaten already",
    dialects: {
      sixian: { pfs: 'siid8 bau3 le1', tones: 'siid bàu lē' },
      hailu: { pfs: 'siid8 bau3 le1', tones: 'siid bàu lē' },
    },
  },

  // === NUMBERS ===
  {
    id: 'num-01',
    topic: 'numbers',
    characters: '一',
    english: 'One (1)',
    dialects: {
      sixian: { pfs: 'yid4', tones: 'yid' },
      hailu: { pfs: 'yid4', tones: 'yid' },
    },
  },
  {
    id: 'num-02',
    topic: 'numbers',
    characters: '二',
    english: 'Two (2)',
    dialects: {
      sixian: { pfs: 'ngi5', tones: 'ngī' },
      hailu: { pfs: 'ngi5', tones: 'ngī' },
    },
  },
  {
    id: 'num-03',
    topic: 'numbers',
    characters: '三',
    english: 'Three (3)',
    dialects: {
      sixian: { pfs: 'sam1', tones: 'sām' },
      hailu: { pfs: 'sam1', tones: 'sām' },
    },
  },
  {
    id: 'num-04',
    topic: 'numbers',
    characters: '四',
    english: 'Four (4)',
    dialects: {
      sixian: { pfs: 'si5', tones: 'sī' },
      hailu: { pfs: 'si5', tones: 'sī' },
    },
  },
  {
    id: 'num-05',
    topic: 'numbers',
    characters: '五',
    english: 'Five (5)',
    dialects: {
      sixian: { pfs: 'ng3', tones: 'ng̀' },
      hailu: { pfs: 'ng3', tones: 'ng̀' },
    },
  },
  {
    id: 'num-06',
    topic: 'numbers',
    characters: '六',
    english: 'Six (6)',
    dialects: {
      sixian: { pfs: 'liug4', tones: 'liug' },
      hailu: { pfs: 'liug4', tones: 'liug' },
    },
  },
  {
    id: 'num-07',
    topic: 'numbers',
    characters: '七',
    english: 'Seven (7)',
    dialects: {
      sixian: { pfs: 'qid4', tones: 'qid' },
      hailu: { pfs: 'qid4', tones: 'qid' },
    },
  },
  {
    id: 'num-08',
    topic: 'numbers',
    characters: '八',
    english: 'Eight (8)',
    dialects: {
      sixian: { pfs: 'bad4', tones: 'bad' },
      hailu: { pfs: 'bad4', tones: 'bad' },
    },
  },
  {
    id: 'num-09',
    topic: 'numbers',
    characters: '九',
    english: 'Nine (9)',
    dialects: {
      sixian: { pfs: 'giu3', tones: 'giù' },
      hailu: { pfs: 'giu3', tones: 'giù' },
    },
  },
  {
    id: 'num-10',
    topic: 'numbers',
    characters: '十',
    english: 'Ten (10)',
    dialects: {
      sixian: { pfs: 'siib8', tones: 'siib' },
      hailu: { pfs: 'siib8', tones: 'siib' },
    },
  },

  // === FAMILY ===
  {
    id: 'fam-01',
    topic: 'family',
    characters: '阿爸',
    english: 'Father',
    dialects: {
      sixian: { pfs: 'a1 ba1', tones: 'ā bā' },
      hailu: { pfs: 'a1 ba1', tones: 'ā bā' },
    },
  },
  {
    id: 'fam-02',
    topic: 'family',
    characters: '阿姆',
    english: 'Mother',
    dialects: {
      sixian: { pfs: 'a1 me1', tones: 'ā mē' },
      hailu: { pfs: 'a1 me1', tones: 'ā mē' },
    },
  },
  {
    id: 'fam-03',
    topic: 'family',
    characters: '阿公',
    english: 'Grandfather (paternal)',
    dialects: {
      sixian: { pfs: 'a1 gung1', tones: 'ā gūng' },
      hailu: { pfs: 'a1 gung1', tones: 'ā gūng' },
    },
  },
  {
    id: 'fam-04',
    topic: 'family',
    characters: '阿婆',
    english: 'Grandmother (paternal)',
    dialects: {
      sixian: { pfs: 'a1 po2', tones: 'ā pò' },
      hailu: { pfs: 'a1 po2', tones: 'ā pò' },
    },
  },
  {
    id: 'fam-05',
    topic: 'family',
    characters: '阿哥',
    english: 'Older brother',
    dialects: {
      sixian: { pfs: 'a1 go1', tones: 'ā gō' },
      hailu: { pfs: 'a1 go1', tones: 'ā gō' },
    },
  },
  {
    id: 'fam-06',
    topic: 'family',
    characters: '阿姊',
    english: 'Older sister',
    dialects: {
      sixian: { pfs: 'a1 zi3', tones: 'ā zì' },
      hailu: { pfs: 'a1 zi3', tones: 'ā zì' },
    },
  },
  {
    id: 'fam-07',
    topic: 'family',
    characters: '老弟',
    english: 'Younger brother',
    dialects: {
      sixian: { pfs: 'lo3 tai5', tones: 'lò tāi' },
      hailu: { pfs: 'lo3 tai5', tones: 'lò tāi' },
    },
  },
  {
    id: 'fam-08',
    topic: 'family',
    characters: '老妹',
    english: 'Younger sister',
    dialects: {
      sixian: { pfs: 'lo3 moi5', tones: 'lò mōi' },
      hailu: { pfs: 'lo3 moi5', tones: 'lò mōi' },
    },
  },
  {
    id: 'fam-09',
    topic: 'family',
    characters: '細人仔',
    english: 'Child / Children',
    dialects: {
      sixian: { pfs: 'se5 ngin2 e3', tones: 'sē ngìn é' },
      hailu: { pfs: 'se5 ngin2 e3', tones: 'sē ngìn é' },
    },
  },
  {
    id: 'fam-10',
    topic: 'family',
    characters: '屋下人',
    english: 'Family members',
    dialects: {
      sixian: { pfs: 'vug4 ha1 ngin2', tones: 'vug hā ngìn' },
      hailu: { pfs: 'vug4 ha1 ngin2', tones: 'vug hā ngìn' },
    },
  },

  // === FOOD ===
  {
    id: 'food-01',
    topic: 'food',
    characters: '粄條',
    english: 'Flat rice noodles (ban tiao)',
    dialects: {
      sixian: { pfs: 'ban3 tiau2', tones: 'bàn tiàu' },
      hailu: { pfs: 'ban3 tiau2', tones: 'bàn tiàu' },
    },
  },
  {
    id: 'food-02',
    topic: 'food',
    characters: '擂茶',
    english: 'Ground tea (lei cha)',
    dialects: {
      sixian: { pfs: 'lui2 ca2', tones: 'lùi cà' },
      hailu: { pfs: 'lui2 ca2', tones: 'lùi cà' },
    },
  },
  {
    id: 'food-03',
    topic: 'food',
    characters: '釀豆腐',
    english: 'Stuffed tofu',
    dialects: {
      sixian: { pfs: 'niong5 teu5 fu5', tones: 'niōng tēu fū' },
      hailu: { pfs: 'niong5 teu5 fu5', tones: 'niōng tēu fū' },
    },
  },
  {
    id: 'food-04',
    topic: 'food',
    characters: '飯',
    english: 'Rice (cooked)',
    dialects: {
      sixian: { pfs: 'fan5', tones: 'fān' },
      hailu: { pfs: 'fan5', tones: 'fān' },
    },
  },
  {
    id: 'food-05',
    topic: 'food',
    characters: '茶',
    english: 'Tea',
    dialects: {
      sixian: { pfs: 'ca2', tones: 'cà' },
      hailu: { pfs: 'ca2', tones: 'cà' },
    },
  },
  {
    id: 'food-06',
    topic: 'food',
    characters: '水',
    english: 'Water',
    dialects: {
      sixian: { pfs: 'sui3', tones: 'sùi' },
      hailu: { pfs: 'sui3', tones: 'sùi' },
    },
  },
  {
    id: 'food-07',
    topic: 'food',
    characters: '肉',
    english: 'Meat',
    dialects: {
      sixian: { pfs: 'niug4', tones: 'niug' },
      hailu: { pfs: 'niug4', tones: 'niug' },
    },
  },
  {
    id: 'food-08',
    topic: 'food',
    characters: '菜',
    english: 'Vegetables',
    dialects: {
      sixian: { pfs: 'coi5', tones: 'cōi' },
      hailu: { pfs: 'coi5', tones: 'cōi' },
    },
  },
  {
    id: 'food-09',
    topic: 'food',
    characters: '鹹菜',
    english: 'Pickled mustard greens',
    dialects: {
      sixian: { pfs: 'ham2 coi5', tones: 'hàm cōi' },
      hailu: { pfs: 'ham2 coi5', tones: 'hàm cōi' },
    },
  },
  {
    id: 'food-10',
    topic: 'food',
    characters: '客家小炒',
    english: 'Hakka stir-fry',
    dialects: {
      sixian: { pfs: 'hag4 ga1 seu3 cau3', tones: 'hag gā sèu càu' },
      hailu: { pfs: 'hag4 ga1 seu3 cau3', tones: 'hag gā sèu càu' },
    },
  },

  // === DAILY PHRASES ===
  {
    id: 'daily-01',
    topic: 'daily',
    characters: '這個幾多錢？',
    english: 'How much is this?',
    dialects: {
      sixian: { pfs: 'lia1 ge5 gi3 do1 qien2?', tones: 'liā gē gì dō qièn?' },
      hailu: { pfs: 'lia1 ge5 gi3 do1 qien2?', tones: 'liā gē gì dō qièn?' },
    },
  },
  {
    id: 'daily-02',
    topic: 'daily',
    characters: '在哪位？',
    english: 'Where is it?',
    dialects: {
      sixian: { pfs: 'cai5 nai2 vi5?', tones: 'cāi nài vī?' },
      hailu: { pfs: 'cai5 nai2 vi5?', tones: 'cāi nài vī?' },
    },
  },
  {
    id: 'daily-03',
    topic: 'daily',
    characters: '𠊎係客家人',
    english: 'I am Hakka (person)',
    dialects: {
      sixian: { pfs: 'ngai2 he5 hag4 ga1 ngin2', tones: 'ngài hē hag gā ngìn' },
      hailu: { pfs: 'ngai2 he5 hag4 ga1 ngin2', tones: 'ngài hē hag gā ngìn' },
    },
  },
  {
    id: 'daily-04',
    topic: 'daily',
    characters: '𠊎毋識講',
    english: "I don't know how to say it",
    dialects: {
      sixian: { pfs: 'ngai2 m2 siid4 gong3', tones: 'ngài m̀ siid góng' },
      hailu: { pfs: 'ngai2 m2 siid4 gong3', tones: 'ngài m̀ siid góng' },
    },
  },
  {
    id: 'daily-05',
    topic: 'daily',
    characters: '你講客話無？',
    english: 'Do you speak Hakka?',
    dialects: {
      sixian: { pfs: 'ngi2 gong3 hag4 fa5 mo2?', tones: 'ngì góng hag fā mò?' },
      hailu: { pfs: 'ngi5 gong3 hag4 fa5 mo2?', tones: 'ngì góng hag fā mò?' },
    },
  },
  {
    id: 'daily-06',
    topic: 'daily',
    characters: '愛',
    english: 'Want / Love',
    dialects: {
      sixian: { pfs: 'oi5', tones: 'ōi' },
      hailu: { pfs: 'oi5', tones: 'ōi' },
    },
  },
  {
    id: 'daily-07',
    topic: 'daily',
    characters: '毋愛',
    english: "Don't want",
    dialects: {
      sixian: { pfs: 'm2 oi5', tones: 'm̀ ōi' },
      hailu: { pfs: 'm2 oi5', tones: 'm̀ ōi' },
    },
  },
  {
    id: 'daily-08',
    topic: 'daily',
    characters: '好食',
    english: 'Delicious',
    dialects: {
      sixian: { pfs: 'ho3 siid8', tones: 'hó siid' },
      hailu: { pfs: 'ho3 siid8', tones: 'hó siid' },
    },
  },
  {
    id: 'daily-09',
    topic: 'daily',
    characters: '慢慢來',
    english: 'Take your time',
    dialects: {
      sixian: { pfs: 'man5 man5 loi2', tones: 'mān mān lòi' },
      hailu: { pfs: 'man5 man5 loi2', tones: 'mān mān lòi' },
    },
  },
  {
    id: 'daily-10',
    topic: 'daily',
    characters: '今晡日',
    english: 'Today',
    dialects: {
      sixian: { pfs: 'gim1 bu1 ngid4', tones: 'gīm bū ngid' },
      hailu: { pfs: 'gim1 bu1 ngid4', tones: 'gīm bū ngid' },
    },
  },
];

export const DIALOGUES = [
  {
    id: 'dialogue-01',
    title: 'At the Market',
    titleChinese: '在市場',
    topic: 'food',
    lines: [
      { speaker: 'A', characters: '你好！這個幾多錢？', english: 'Hello! How much is this?', dialectKey: 'daily-01' },
      { speaker: 'B', characters: '這個五十蚊。', english: "This is $50.", pfs: { sixian: 'lia1 ge5 ng3 siib8 men1', hailu: 'lia1 ge5 ng3 siib8 men1' } },
      { speaker: 'A', characters: '好，𠊎愛。', english: "OK, I'll take it.", pfs: { sixian: 'ho3, ngai2 oi5', hailu: 'ho3, ngai2 oi5' } },
      { speaker: 'B', characters: '多謝！', english: 'Thank you!', dialectKey: 'greet-04' },
      { speaker: 'A', characters: '多謝你！再見！', english: 'Thank you! Goodbye!', pfs: { sixian: 'do1 qia5 ngi2! zai5 gien5!', hailu: 'do1 qia5 ngi5! zai5 gien5!' } },
    ],
  },
  {
    id: 'dialogue-02',
    title: 'Meeting Someone',
    titleChinese: '初次見面',
    topic: 'greetings',
    lines: [
      { speaker: 'A', characters: '你好！你講客話無？', english: 'Hello! Do you speak Hakka?', dialectKey: 'daily-05' },
      { speaker: 'B', characters: '會啊！𠊎係客家人。', english: "Yes! I'm Hakka.", pfs: { sixian: 'voi5 a1! ngai2 he5 hag4 ga1 ngin2.', hailu: 'voi5 a1! ngai2 he5 hag4 ga1 ngin2.' } },
      { speaker: 'A', characters: '㧡好！你食飽未？', english: 'Great! Have you eaten?', dialectKey: 'greet-09' },
      { speaker: 'B', characters: '食飽了，多謝。', english: "I've eaten, thanks.", pfs: { sixian: 'siid8 bau3 le1, do1 qia5.', hailu: 'siid8 bau3 le1, do1 qia5.' } },
    ],
  },
  {
    id: 'dialogue-03',
    title: 'Ordering Food',
    titleChinese: '點菜',
    topic: 'food',
    lines: [
      { speaker: 'A', characters: '請問，有粄條無？', english: 'Excuse me, do you have ban tiao?', pfs: { sixian: 'qiang3 mun5, iu1 ban3 tiau2 mo2?', hailu: 'qiang3 mun5, iu1 ban3 tiau2 mo2?' } },
      { speaker: 'B', characters: '有！愛幾多？', english: 'Yes! How much do you want?', pfs: { sixian: 'iu1! oi5 gi3 do1?', hailu: 'iu1! oi5 gi3 do1?' } },
      { speaker: 'A', characters: '𠊎愛一碗。', english: 'I want one bowl.', pfs: { sixian: 'ngai2 oi5 yid4 von3.', hailu: 'ngai2 oi5 yid4 von3.' } },
      { speaker: 'B', characters: '好，慢慢食。', english: 'OK, enjoy your meal.', pfs: { sixian: 'ho3, man5 man5 siid8.', hailu: 'ho3, man5 man5 siid8.' } },
      { speaker: 'A', characters: '好食！多謝！', english: 'Delicious! Thanks!', pfs: { sixian: 'ho3 siid8! do1 qia5!', hailu: 'ho3 siid8! do1 qia5!' } },
    ],
  },
];

export const SCENARIOS = [
  {
    id: 'scenario-01',
    title: 'Someone greets you',
    titleChinese: '有人同你打招呼',
    topic: 'greetings',
    prompt: { characters: '食飽未？', english: 'Have you eaten?' },
    choices: [
      { characters: '食飽了', english: "Yes, I've eaten", correct: true, pfs: { sixian: 'siid8 bau3 le1' } },
      { characters: '多謝', english: 'Thank you', correct: false },
      { characters: '再見', english: 'Goodbye', correct: false },
    ],
  },
  {
    id: 'scenario-02',
    title: 'At a restaurant',
    titleChinese: '在餐廳',
    topic: 'food',
    prompt: { characters: '愛食麼个？', english: 'What would you like to eat?' },
    choices: [
      { characters: '𠊎愛一碗粄條', english: 'I want a bowl of ban tiao', correct: true, pfs: { sixian: 'ngai2 oi5 yid4 von3 ban3 tiau2' } },
      { characters: '再見', english: 'Goodbye', correct: false },
      { characters: '你好', english: 'Hello', correct: false },
    ],
  },
  {
    id: 'scenario-03',
    title: 'Someone asks if you speak Hakka',
    titleChinese: '有人問你講毋講客話',
    topic: 'daily',
    prompt: { characters: '你講客話無？', english: 'Do you speak Hakka?' },
    choices: [
      { characters: '會啊！𠊎係客家人', english: "Yes! I'm Hakka", correct: true, pfs: { sixian: 'voi5 a1! ngai2 he5 hag4 ga1 ngin2' } },
      { characters: '好食', english: 'Delicious', correct: false },
      { characters: '幾多錢？', english: 'How much?', correct: false },
    ],
  },
  {
    id: 'scenario-04',
    title: 'Asking for price',
    titleChinese: '問價錢',
    topic: 'daily',
    prompt: { characters: '(You want to ask how much something costs)', english: 'How do you ask the price?' },
    choices: [
      { characters: '這個幾多錢？', english: 'How much is this?', correct: true, pfs: { sixian: 'lia1 ge5 gi3 do1 qien2?' } },
      { characters: '在哪位？', english: 'Where is it?', correct: false },
      { characters: '食飽未？', english: 'Have you eaten?', correct: false },
    ],
  },
];
