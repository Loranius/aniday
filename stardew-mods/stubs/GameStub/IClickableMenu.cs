using Microsoft.Xna.Framework;
using Microsoft.Xna.Framework.Graphics;
using Microsoft.Xna.Framework.Input;

namespace StardewValley.Menus
{
    // Mirrors the members of the real StardewValley.Menus.IClickableMenu that the mod overrides.
    public abstract class IClickableMenu
    {
        public int xPositionOnScreen;
        public int yPositionOnScreen;
        public int width;
        public int height;

        public IClickableMenu() { }

        public virtual void receiveLeftClick(int x, int y, bool playSound = true) { }
        public virtual void leftClickHeld(int x, int y) { }
        public virtual void releaseLeftClick(int x, int y) { }
        public virtual void receiveRightClick(int x, int y, bool playSound = true) { }
        public virtual void receiveScrollWheelAction(int direction) { }
        public virtual void receiveKeyPress(Keys key) { }
        public virtual void performHoverAction(int x, int y) { }
        public virtual void update(GameTime time) { }
        public virtual void draw(SpriteBatch b) { }
        public virtual bool readyToClose() => true;
        public virtual void gameWindowSizeChanged(Rectangle oldBounds, Rectangle newBounds) { }
    }
}
