const test = require("ava");

const { match } = require("@masaeedu/adt");
const { mdo } = require("@masaeedu/do");

const { RStream, FS, HTTPS, Prc } = require("..");
const { Fn, Kleisli, Either, EitherT, Cont, Str } = require("@masaeedu/fp");

const ECont = EitherT(Cont);
const snap = t => x => {
  t.snapshot(x);
  t.end();
};

const get = Fn.passthru(HTTPS.get)([
  HTTPS.followRedirects,
  Kleisli(ECont)["<:"](HTTPS.validateCode)
]);

const getJSON = Kleisli(ECont)["<:"](HTTPS.readJSONBody)(get);

test.cb("get requests work when they should work", t => {
  const main = getJSON("https://reqres.in/api/users?page=2");
  main(snap(t));
});

test.cb("get requests fail when they should fail", t => {
  const main = Fn.passthru("https://reqres.in/api/users/23")([
    getJSON,
    Cont.map(Either.lmap(({ response: _, ...x }) => x))
  ]);
  main(snap(t));
});

test.cb("streams interact properly", t => {
  const url = "https://reqres.in/api/unknown";
  const main = mdo(ECont)(({ path, ws, res, content }) => [
    // Download something into a temp file
    [path, () => ECont.lift(FS.tempFilePath)],
    [ws, () => ECont.lift(FS.createWriteStream(path))],
    [res, () => get(url)],
    () => RStream.pipe(res)(ws),

    // Read it back out of the temp file
    [content, () => ECont.lift(FS.createReadStream(path))],
    () => RStream.fold(Str)(content)
  ]);
  main(snap(t));
});

test.cb("passing stdin works", t => {
  const main = mdo(ECont)(({ stdin, result }) => [
    [stdin, () => ECont.lift(RStream.create(`echo "Hello, World!"`))],
    [result, () => Prc.runWithStdin(stdin)({ command: "bash" })],
    () => ECont.of(result.stdout)
  ]);

  main(snap(t));
});
