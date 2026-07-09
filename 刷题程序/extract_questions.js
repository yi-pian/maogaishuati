const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const appDir = __dirname;
const rootDir = path.dirname(appDir);
const docxFile = fs
  .readdirSync(rootDir)
  .filter((name) => name.toLowerCase().endsWith(".docx"))
  .map((name) => ({
    name,
    path: path.join(rootDir, name),
    mtime: fs.statSync(path.join(rootDir, name)).mtimeMs,
  }))
  .sort((a, b) => b.mtime - a.mtime)[0];

if (!docxFile) {
  throw new Error(`Cannot find a .docx file in ${rootDir}`);
}

function cleanText(value) {
  return value
    .replace(/\u00a0/g, " ")
    .replace(/\r?\n+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const plain = execFileSync("pandoc", ["--track-changes=all", "-t", "plain", docxFile.path], {
  encoding: "utf8",
  maxBuffer: 1024 * 1024 * 20,
});

const questions = [];
const questionRegex = /^\s*(\d+)、\s*([\s\S]*?)(?=^\s*\d+、\s*|(?![\s\S]))/gm;
let match;

while ((match = questionRegex.exec(plain)) !== null) {
  const number = Number(match[1]);
  const body = match[2].trim();
  const stemMatch = body.match(/^([\s\S]*?)(?=^\s*A、|^\s*答案：|(?![\s\S]))/m);
  const stem = cleanText(stemMatch ? stemMatch[1] : "");
  const options = [];
  const optionRegex = /^\s*([A-D])、\s*([\s\S]*?)(?=^\s*[A-D]、\s*|^\s*答案：|(?![\s\S]))/gm;
  let optionMatch;

  while ((optionMatch = optionRegex.exec(body)) !== null) {
    options.push({
      label: optionMatch[1],
      text: cleanText(optionMatch[2]),
    });
  }

  const answerMatch = body.match(/^\s*答案：\s*([A-D]+)/m);
  const answer = answerMatch ? answerMatch[1].split("") : [];

  if (!stem || options.length === 0 || answer.length === 0) {
    throw new Error(`Failed to parse question ${number}`);
  }

  questions.push({
    id: `q${String(number).padStart(3, "0")}`,
    number,
    type: answer.length > 1 ? "multiple" : "single",
    stem,
    options,
    answer,
  });
}

if (questions.length === 0) {
  throw new Error("No questions parsed from the DOCX file");
}

const singleCount = questions.filter((question) => question.type === "single").length;
const multipleCount = questions.filter((question) => question.type === "multiple").length;
const output = `window.QUESTION_BANK=${JSON.stringify(questions)};\n`;
fs.writeFileSync(path.join(appDir, "questions.js"), output, "utf8");

console.log(`source=${docxFile.name}`);
console.log(`questions=${questions.length}`);
console.log(`single=${singleCount}`);
console.log(`multiple=${multipleCount}`);
console.log(`output=${path.join(appDir, "questions.js")}`);
