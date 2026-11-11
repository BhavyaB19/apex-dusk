import { Game } from './game/game';
import { Menu } from './ui/menu';

const game = new Game(document.getElementById('c') as HTMLCanvasElement);
const menu = new Menu(game);
game.run();

// Handy for poking at the game from the browser console.
Object.assign(window, { __game: game, __menu: menu });
