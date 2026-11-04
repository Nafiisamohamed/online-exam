/**
 * Seed content: realistic question banks, Somali names, cities and phone numbers.
 * Compact helpers build QuestionInput objects (validated by core/questionRules on seed).
 * `p` (optional) forces the simulated share of students who answer correctly, so the
 * analytics screen has a too-easy and a too-hard question to highlight.
 */
import type { QuestionInput, QDifficulty, RubricCriterion } from '../src/core/questionRules';

export type SeedQuestion = QuestionInput & { p?: number };

const mcq = (difficulty: QDifficulty, topic: string, text: string, options: string[], correct = 0, marks = 2, p?: number): SeedQuestion => ({
  type: 'MCQ', difficulty, topic, text, marks, p,
  options: options.map((o, i) => ({ text: o, isCorrect: i === correct })),
});
const tf = (difficulty: QDifficulty, topic: string, text: string, answer: boolean, marks = 1, p?: number): SeedQuestion => ({
  type: 'TRUE_FALSE', difficulty, topic, text, marks, p,
  options: [{ text: 'True', isCorrect: answer }, { text: 'False', isCorrect: !answer }],
});
const sa = (difficulty: QDifficulty, topic: string, text: string, accepted: string[], marks = 2, p?: number): SeedQuestion => ({
  type: 'SHORT_ANSWER', difficulty, topic, text, marks, acceptedAnswers: accepted, p,
});
const essay = (difficulty: QDifficulty, topic: string, text: string, marks: number, rubric: RubricCriterion[]): SeedQuestion => ({
  type: 'ESSAY', difficulty, topic, text, marks, rubric,
});

export const CS101_QUESTIONS: SeedQuestion[] = [
  // EASY
  mcq('EASY', 'Hardware', 'What does CPU stand for?', ['Central Processing Unit', 'Computer Personal Unit', 'Central Program Utility', 'Control Processing Unit']),
  mcq('EASY', 'Hardware', 'Which device is used to type text into a computer?', ['Keyboard', 'Monitor', 'Printer', 'Speaker']),
  mcq('EASY', 'Hardware', 'Which of these is an output device?', ['Monitor', 'Mouse', 'Scanner', 'Microphone']),
  tf('EASY', 'Hardware', 'RAM keeps its data when the computer is switched off.', false),
  mcq('EASY', 'Software', 'Which of these is an operating system?', ['Windows 11', 'Microsoft Word', 'Google Chrome', 'WhatsApp']),
  tf('EASY', 'Software', 'A web browser is an example of application software.', true),
  mcq('EASY', 'Internet', 'What does WWW stand for?', ['World Wide Web', 'World Web Wide', 'Wide World Web', 'Web World Wide']),
  sa('EASY', 'Internet', 'What is the short name of the protocol that loads web pages securely (the padlock in the browser)?', ['HTTPS']),
  mcq('EASY', 'Data', 'How many bits are in one byte?', ['8', '4', '16', '10']),
  tf('EASY', 'Data', 'One kilobyte is larger than one megabyte.', false),
  mcq('EASY', 'Security', 'Which password is the strongest?', ['Xamar#2026!Badda', '123456', 'password', 'ahmed']),
  tf('EASY', 'Security', 'You should share your mobile money PIN with anyone who calls saying they work for the telecom company.', false),
  mcq('EASY', 'Networking', 'Which device connects computers in a small office network using cables?', ['Switch', 'Monitor', 'Printer', 'Webcam']),
  sa('EASY', 'Data', 'Which number system uses only the digits 0 and 1?', ['binary', 'base 2', 'base-2']),
  mcq('EASY', 'Software', 'Which file extension is usually a Microsoft Excel spreadsheet?', ['.xlsx', '.docx', '.mp3', '.pptx']),
  tf('EASY', 'Internet', 'Every email address contains the @ symbol.', true),
  // MEDIUM
  mcq('MEDIUM', 'Networking', 'What does LAN stand for?', ['Local Area Network', 'Large Access Network', 'Linked Area Node', 'Local Access Number']),
  mcq('MEDIUM', 'Networking', 'Which protocol automatically gives IP addresses to computers on a network?', ['DHCP', 'FTP', 'SMTP', 'HTML']),
  sa('MEDIUM', 'Networking', 'Which protocol is used to send email?', ['SMTP', 'Simple Mail Transfer Protocol']),
  tf('MEDIUM', 'Networking', '192.168.1.10 is a private IP address.', true),
  mcq('MEDIUM', 'Security', "A fake message asking a student to 'confirm' their university password on a strange website is called:", ['Phishing', 'Formatting', 'Compiling', 'Buffering']),
  mcq('MEDIUM', 'Security', 'What is the main purpose of a firewall?', ['To control which network traffic is allowed in and out', 'To cool down the CPU', 'To make the printer faster', 'To store backups']),
  tf('MEDIUM', 'Security', 'Two-factor authentication combines something you know with something you have.', true),
  sa('MEDIUM', 'Security', 'What type of malicious software locks your files and demands payment?', ['ransomware']),
  mcq('MEDIUM', 'Software', 'Which of these is open-source software?', ['Linux', 'Windows 11', 'Adobe Photoshop', 'Microsoft Office']),
  mcq('MEDIUM', 'Software', 'What does a compiler do?', ['Translates source code into machine code', 'Prints documents', 'Connects to Wi-Fi', 'Deletes viruses']),
  tf('MEDIUM', 'Software', 'Installing software updates can fix security weaknesses.', true),
  mcq('MEDIUM', 'Hardware', 'Which storage is usually the fastest?', ['SSD', 'Hard disk drive', 'DVD', 'USB 2.0 flash drive']),
  mcq('MEDIUM', 'Data', 'What is decimal 5 in binary?', ['101', '110', '111', '100']),
  sa('MEDIUM', 'Hardware', 'What does GPU stand for?', ['Graphics Processing Unit']),
  // HARD
  mcq('HARD', 'Networking', 'A computer lab uses the network 192.168.10.0/24. How many usable host addresses does it have?', ['254', '256', '255', '24'], 0, 3),
  mcq('HARD', 'Data', 'What is decimal 255 in hexadecimal?', ['FF', 'EE', 'F0', '99'], 0, 3),
  mcq('HARD', 'Security', 'What is the best way for a university system to store student passwords?', ['Hash them with bcrypt', 'Store them as plain text', 'Email them to the registrar', 'Save them in an Excel file'], 0, 3),
  sa('HARD', 'Networking', 'Which port number does HTTPS use by default?', ['443'], 3),
  essay('HARD', 'Networking', 'Explain how a local area network could help a hospital in Mogadishu share patient records safely. Mention at least two security measures.', 10, [
    { criterion: 'Explains the benefits of a LAN', points: 4 },
    { criterion: 'Describes two or more security measures', points: 4 },
    { criterion: 'Clear writing with examples', points: 2 },
  ]),
  essay('HARD', 'Security', 'A student receives an SMS saying they won a prize and must send their mobile money PIN to claim it. Explain what kind of attack this is and how students can protect themselves.', 10, [
    { criterion: 'Identifies the attack (social engineering / phishing)', points: 3 },
    { criterion: 'Gives practical protection steps', points: 5 },
    { criterion: 'Clear writing', points: 2 },
  ]),
  tf('HARD', 'Data', 'An IPv4 address has 4 octets of 8 bits each.', true, 2),
  mcq('HARD', 'Software', "Which data structure works on a 'last in, first out' basis?", ['Stack', 'Queue', 'Array', 'Tree'], 0, 3),
];

export const CS205_QUESTIONS: SeedQuestion[] = [
  // EASY
  mcq('EASY', 'SQL', 'Which SQL command reads data from a table?', ['SELECT', 'INSERT', 'UPDATE', 'DELETE'], 0, 2, 1),
  mcq('EASY', 'SQL', 'Which SQL command adds a new row to a table?', ['INSERT', 'SELECT', 'DROP', 'ALTER']),
  tf('EASY', 'Basics', 'A primary key column can contain duplicate values.', false),
  mcq('EASY', 'Basics', 'What does DBMS stand for?', ['Database Management System', 'Data Backup Main Server', 'Digital Base Memory Storage', 'Database Module Script']),
  tf('EASY', 'Basics', 'PostgreSQL is a relational database.', true),
  mcq('EASY', 'SQL', 'Which clause filters rows in a SELECT statement?', ['WHERE', 'ORDER BY', 'GROUP BY', 'FROM']),
  sa('EASY', 'SQL', 'Which two SQL keywords sort the results of a query?', ['ORDER BY']),
  mcq('EASY', 'Basics', 'In a table of students, one row is called a:', ['Record', 'Column', 'Schema', 'Index']),
  tf('EASY', 'SQL', 'COUNT(*) returns the number of rows.', true),
  mcq('EASY', 'Modelling', 'In an ER diagram, a line connecting two entities shows a:', ['Relationship', 'Primary key', 'Query', 'Trigger']),
  // MEDIUM
  mcq('MEDIUM', 'Modelling', 'One faculty has many courses. This relationship is:', ['One-to-many', 'One-to-one', 'Many-to-many', 'No relationship']),
  mcq('MEDIUM', 'SQL', 'Which JOIN returns only the rows that match in both tables?', ['INNER JOIN', 'LEFT JOIN', 'FULL OUTER JOIN', 'CROSS JOIN']),
  sa('MEDIUM', 'Modelling', 'What do we call a column that refers to the primary key of another table?', ['foreign key', 'FK']),
  tf('MEDIUM', 'Normalisation', 'Second normal form removes partial dependencies on a composite key.', true),
  mcq('MEDIUM', 'Normalisation', "Storing a student's phone number in every enrolment row mainly causes:", ['Update anomalies', 'Faster backups', 'Better security', 'Smaller tables']),
  mcq('MEDIUM', 'SQL', 'Which function returns the average of a column?', ['AVG()', 'SUM()', 'MAX()', 'COUNT()']),
  mcq('MEDIUM', 'Transactions', 'Which ACID property means a transaction is all-or-nothing?', ['Atomicity', 'Consistency', 'Isolation', 'Durability']),
  sa('MEDIUM', 'SQL', 'Which SQL clause filters groups after GROUP BY?', ['HAVING']),
  tf('MEDIUM', 'Transactions', 'ROLLBACK makes the changes of a transaction permanent.', false),
  // HARD
  mcq('HARD', 'Transactions', 'Two cashiers in Hargeisa update the same account balance at the same moment and one update disappears. This problem is called:', ['Lost update', 'Dirty read', 'Phantom read', 'Deadlock'], 0, 3),
  mcq('HARD', 'Indexing', 'Which index type does PostgreSQL create by default?', ['B-tree', 'Hash', 'Bitmap', 'GiST'], 0, 3, 0.1),
  essay('HARD', 'Modelling', 'Design tables for a mobile money system with customers, accounts and transfers. Give the primary and foreign keys and explain one rule the database must enforce.', 10, [
    { criterion: 'Correct tables and columns', points: 4 },
    { criterion: 'Primary and foreign keys', points: 4 },
    { criterion: 'Business rule explained', points: 2 },
  ]),
  sa('HARD', 'Normalisation', 'Which normal form requires every determinant to be a candidate key? (abbreviation)', ['BCNF', 'Boyce-Codd normal form', 'Boyce Codd Normal Form'], 3),
  tf('HARD', 'Indexing', 'Adding an index always makes INSERT statements faster.', false, 2),
];

export const HS120_QUESTIONS: SeedQuestion[] = [
  mcq('EASY', 'Hygiene', 'What is the most effective simple way to prevent the spread of cholera?', ['Washing hands with soap and safe water', 'Sleeping more hours', 'Eating spicy food', 'Wearing sunglasses']),
  tf('EASY', 'Hygiene', 'Boiling drinking water helps kill germs.', true),
  mcq('EASY', 'Nutrition', 'Which food is a good source of protein?', ['Beans', 'Sugar', 'Tea', 'Cooking oil']),
  tf('EASY', 'Vaccination', 'Measles can be prevented by vaccination.', true),
  mcq('EASY', 'Vaccination', 'Vaccines work by:', ['Training the immune system', 'Killing all bacteria in the body', 'Replacing blood', 'Cooling the body']),
  sa('EASY', 'Hygiene', 'Name the water-borne disease that causes severe watery diarrhoea and spreads quickly in camps.', ['cholera']),
  mcq('EASY', 'Nutrition', 'Oral rehydration salts (ORS) are given to treat:', ['Dehydration', 'Broken bones', 'Headache only', 'Eye infection']),
  mcq('MEDIUM', 'Epidemiology', 'The number of NEW cases of a disease in a period is called:', ['Incidence', 'Prevalence', 'Mortality', 'Fertility']),
  tf('MEDIUM', 'Epidemiology', 'Malaria is spread by mosquitoes.', true),
  sa('MEDIUM', 'Epidemiology', 'Which insect spreads malaria?', ['mosquito', 'anopheles mosquito', 'anopheles']),
  mcq('MEDIUM', 'Maternal health', 'Why are antenatal visits important for pregnant women?', ['To detect and manage risks early', 'To avoid all medicine', 'To replace delivery in a hospital', 'They are not important']),
  mcq('MEDIUM', 'Nutrition', 'Which vitamin deficiency causes night blindness?', ['Vitamin A', 'Vitamin C', 'Vitamin D', 'Vitamin K']),
  essay('HARD', 'Epidemiology', 'During the Gu rainy season, cholera cases rise in IDP camps near Baidoa. Describe three public health interventions to reduce cases and explain why each one works.', 10, [
    { criterion: 'Three relevant interventions', points: 6 },
    { criterion: 'Explains why each works', points: 3 },
    { criterion: 'Clarity', points: 1 },
  ]),
  essay('HARD', 'Maternal health', 'Explain why maternal mortality is high in rural Somalia and suggest two community-level solutions.', 10, [
    { criterion: 'Causes explained', points: 4 },
    { criterion: 'Two realistic solutions', points: 4 },
    { criterion: 'Clarity', points: 2 },
  ]),
  sa('HARD', 'Vaccination', 'What does EPI stand for in child health programmes?', ['Expanded Programme on Immunization', 'Expanded Program on Immunization', 'Expanded Programme on Immunisation'], 3),
];

export const BA110_QUESTIONS: SeedQuestion[] = [
  mcq('EASY', 'Basics', 'The accounting equation is:', ['Assets = Liabilities + Equity', 'Assets = Revenue - Expenses', 'Equity = Assets + Liabilities', 'Cash = Profit']),
  tf('EASY', 'Basics', "Revenue increases the owner's equity.", true),
  mcq('EASY', 'Basics', 'Money owed to a business by its customers is called:', ['Accounts receivable', 'Accounts payable', 'Capital', 'Drawings']),
  mcq('EASY', 'Basics', 'Which of these is an asset?', ['Cash in the bank', 'A bank loan', 'Unpaid salaries', "Owner's capital"]),
  sa('EASY', 'Statements', 'Which statement shows revenue and expenses for a period?', ['income statement', 'profit and loss statement', 'profit and loss account', 'P&L']),
  tf('EASY', 'Ledger', 'In double-entry bookkeeping every transaction affects at least two accounts.', true),
  mcq('MEDIUM', 'Ledger', 'A shop in Bakaara Market buys goods on credit. Which account is credited?', ['Accounts payable', 'Cash', 'Sales', 'Inventory']),
  mcq('MEDIUM', 'Ledger', 'A debit entry increases which type of account?', ['Assets', 'Liabilities', 'Revenue', 'Equity']),
  mcq('MEDIUM', 'Statements', "Which statement shows a company's financial position on a given date?", ['Balance sheet', 'Income statement', 'Cash budget', 'Sales report']),
  tf('MEDIUM', 'Statements', 'Depreciation reduces the book value of equipment.', true),
  sa('MEDIUM', 'Ledger', 'A business pays $500 rent in cash. Which account is debited?', ['rent expense', 'rent']),
  mcq('HARD', 'Statements', 'A business has revenue of $12,000 and expenses of $8,500. What is the net profit?', ['$3,500', '$20,500', '$8,500', '$4,500'], 0, 3),
  mcq('HARD', 'Depreciation', 'Equipment costs $6,000, has no residual value and a 5-year life. What is the yearly straight-line depreciation?', ['$1,200', '$6,000', '$1,000', '$3,000'], 0, 3),
  essay('HARD', 'Statements', "Explain why a small business in Garowe should keep the owner's personal spending separate from the business records.", 8, [
    { criterion: 'Explains the business entity concept', points: 4 },
    { criterion: 'Practical consequences', points: 3 },
    { criterion: 'Clarity', points: 1 },
  ]),
  tf('HARD', 'Depreciation', 'Land is normally depreciated every year.', false, 2),
];

/** 40 students: [full name, phone]. Phone prefixes: 61/77 Hormuud (Mogadishu), 63 Telesom (Hargeisa), 90 Golis (Garowe). */
export const STUDENTS: [string, string][] = [
  ['Amina Abdi Hassan', '+252615123401'],
  ['Abdullahi Mohamed Warsame', '+252615123402'],
  ['Hodan Ali Farah', '+252615123403'],
  ['Mohamed Abdirahman Yusuf', '+252615123404'],
  ['Fadumo Ahmed Nur', '+252615123405'],
  ['Ahmed Hassan Jama', '+252771234506'],
  ['Sahra Osman Ali', '+252771234507'],
  ['Abdirizak Ibrahim Mohamud', '+252771234508'],
  ['Khadija Yusuf Abdi', '+252634412309'],
  ['Hassan Omar Elmi', '+252634412310'],
  ['Ifrah Abdikarim Said', '+252634412311'],
  ['Mustafe Ali Dahir', '+252634412312'],
  ['Nimco Hussein Aden', '+252907765413'],
  ['Abdiaziz Farah Mohamed', '+252907765414'],
  ['Hibaaq Mohamud Ismail', '+252907765415'],
  ['Yasin Abdullahi Hersi', '+252615123416'],
  ['Ayaan Mohamed Gure', '+252615123417'],
  ['Bashir Ahmed Abdille', '+252615123418'],
  ['Ruqia Hassan Sheikh', '+252615123419'],
  ['Liban Yusuf Barre', '+252615123420'],
  ['Asha Abdi Warsame', '+252771234521'],
  ['Zakariye Mohamed Osman', '+252771234522'],
  ['Maryan Ali Abdullahi', '+252771234523'],
  ['Guled Abdirashid Hussein', '+252634412324'],
  ['Hamdi Omar Mohamed', '+252634412325'],
  ['Fartun Ahmed Hirsi', '+252615123426'],
  ['Abdikadir Hassan Muse', '+252615123427'],
  ['Najma Yusuf Ali', '+252615123428'],
  ['Omar Abdi Ibrahim', '+252771234529'],
  ['Halima Mohamed Farah', '+252771234530'],
  ['Shukri Ali Hassan', '+252634412331'],
  ['Abdirahim Nur Ahmed', '+252634412332'],
  ['Ubah Abdullahi Jama', '+252907765433'],
  ['Mahad Ismail Yusuf', '+252907765434'],
  ['Sagal Hassan Abdi', '+252907765435'],
  ['Idiris Mohamed Ali', '+252615123436'],
  ['Deeqa Osman Warsame', '+252615123437'],
  ['Abshir Farah Nur', '+252771234538'],
  ['Hawa Abdirahman Omar', '+252634412339'],
  ['Kaafi Ahmed Mohamud', '+252907765440'],
];

/** Sample essay answers used for simulated attempts. */
export const ESSAY_ANSWERS = [
  'A local network lets doctors and nurses open the same patient file from different rooms instead of carrying paper. To keep it safe the hospital should use strong passwords, give each worker their own account, and keep a backup server. A firewall should block outside access.',
  'This is a social engineering attack, also called phishing by SMS. The attacker wants the PIN to empty the account. Students should never share their PIN, should call the official customer number to check, and should delete the message and warn friends.',
  'The camps need clean water points with chlorine, latrines that are far from wells, and health education about hand washing with soap. Chlorine kills the bacteria, latrines stop faeces reaching the water, and education changes behaviour so fewer people get infected.',
  'Many mothers live far from a health centre, there are few trained midwives and transport is expensive. Communities can train more community midwives and create a village emergency transport fund so women can reach the hospital in time.',
  'I would create a customers table (customer_id PK, name, phone), an accounts table (account_id PK, customer_id FK, balance) and a transfers table (transfer_id PK, from_account FK, to_account FK, amount, created_at). The database must not allow a balance below zero.',
  'Keeping the records separate shows the true profit of the shop. If the owner takes money for family spending without recording it, the business looks poorer or richer than it is and it is hard to get a loan or pay the right tax.',
];
