process.env.NODE_ENV = 'test';
import "@testing-library/jest-dom";
import { TextDecoder, TextEncoder } from "util";

Object.assign(global, {
  TextEncoder,
  TextDecoder,
});
