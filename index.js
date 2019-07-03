const fs = require("fs");
const stream = require("stream");

const https = require("https");
const tempy = require("tempy");

const { mdo } = require("@masaeedu/do");
const { Fn, Obj, Arr, Str, Either, EitherT, Cont } = require("@masaeedu/fp");

const { Readable } = stream;
const { Left, Right } = Either;
const ECont = EitherT(Cont);

const RStream = (() => {
  // :: Monoid m -> RStream m -> ECont! m
  const fold = M => rs => cb => {
    const problem = "Readable stream failed!";
    let intermediate = M.empty;

    rs.on("data", v => {
      intermediate = M.append(intermediate)(v);
    });
    rs.on("error", () => cb(Left({ problem, intermediate })));
    rs.on("end", () => cb(Right(intermediate)));
  };

  // :: RStream a -> WStream a -> ECont! ()
  const pipe = rs => ws => cb => {
    rs.pipe(ws);
    ws.on("finish", () => cb(Right(undefined)));
    ws.on("error", error =>
      cb(Left({ problem: "Writing to stream failed!", error }))
    );
  };

  // :: a -> Cont! (RStream a)
  const create = a => cb => {
    const r = new Readable();
    r.push(a);
    r.push(null);
    cb(r);
  };

  // :: Cont! (RStream a)
  const empty = cb => {
    const r = new Readable();
    cb(r);
    r.push(null);
  };

  return { fold, pipe, create, empty };
})();

const JS0N = (() => {
  // :: String -> JSON
  const parse = json => {
    try {
      return Right(JSON.parse(json));
    } catch (error) {
      return Left({ problem: "Failed to parse json", error });
    }
  };

  return { parse };
})();

const HTTPS = (() => {
  const ranges = {
    OK: [200, 300],
    REDIRECT: [300, 400]
  };

  const families = statusCode =>
    Obj.foldMapWithKey(Arr)(k => ([min, max]) =>
      min <= statusCode && statusCode < max ? [k] : []
    )(ranges);

  // :: RequestOptions -> Cont! Request
  const makeRequest = opts => cb => cb(https.request(opts));

  // :: Request -> ECont! Response
  const awaitResponse = req => cb => {
    const problem = "Request failed!";
    req.on("error", error => cb(Left({ problem, error, req })));
    req.on("response", r => cb(Right(r)));
  };

  // :: URI -> RequestOptions -> RequestOptions
  const swapURI = uri => opts =>
    typeof opts === "string" ? uri : { ...opts, uri };

  // :: (RequestOptions -> ECont! Response) -> RequestOptions -> ECont! Response
  const followRedirects = f => opts =>
    ECont[">>="](f(opts))(res => {
      const { statusCode, headers } = res;
      const isRedirect = families(statusCode).includes("REDIRECT");
      const follow = followRedirects(f)(swapURI(headers.location)(opts));

      return isRedirect ? follow : ECont.of(res);
    });

  // :: Response -> ECont! Response
  const validateCode = response => {
    const problem = "Response status code indicates failure!";

    const { statusCode } = response;
    const isFailed = !families(statusCode).includes("OK");

    const eject = Fn.passthru(response)([
      RStream.fold(Str),
      ECont.chain(body => ECont.fail({ problem, statusCode, response, body }))
    ]);

    const proceed = ECont.of(response);

    return isFailed ? eject : proceed;
  };

  // :: RStream -> RequestOptions -> ECont! Response
  const requestWithBody = rs => {
    const makeRequest_ = Fn["<:"](ECont.lift)(makeRequest);

    return opts =>
      mdo(ECont)(({ req }) => [
        [req, () => makeRequest_(opts)],
        () => RStream.pipe(rs)(req),
        () => awaitResponse(req)
      ]);
  };

  // :: RequestOptions -> ECont! Response
  const get = opts => {
    const emptyBody = ECont.lift(RStream.empty);
    const rwb = Fn.flip(requestWithBody)(opts);
    return ECont[">>="](emptyBody)(rwb);
  };

  // :: Response -> ECont! JSON
  const readJSONBody = Fn.pipe([
    RStream.fold(Str),
    Cont.map(Either["=<<"](JS0N.parse))
  ]);

  return {
    makeRequest,
    awaitResponse,
    followRedirects,
    validateCode,
    requestWithBody,
    get,
    readJSONBody
  };
})();

const FS = (() => {
  // Default behavior is to autoclose fd on error or finish, so
  // we don't need to worry about that
  // :: FilePath -> Cont! (WStream Buffer)
  const createWriteStream = file => cb => cb(fs.createWriteStream(file));

  // :: FilePath -> Cont! (RStream Buffer)
  const createReadStream = file => cb => cb(fs.createReadStream(file));

  // :: Cont! FilePath
  const tempFilePath = cb => cb(tempy.file());

  // :: FilePath -> FilePath -> ECont! ()
  const copyFile = source => dest => cb =>
    fs.copyFile(source, dest, err => cb(err ? Left(err) : Right()));

  return { createWriteStream, createReadStream, tempFilePath, copyFile };
})();

module.exports = { RStream, HTTPS, FS };
