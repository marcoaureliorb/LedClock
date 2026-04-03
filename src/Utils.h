struct RGB {
  byte r;
  byte g;
  byte b;
};

struct Digits {
  uint8_t tens;
  uint8_t units;
};

String colorToStr(RGB color){
  return String("(") + color.r + "," + color.g + "," + color.b + ")";
}

RGB getColor(String red, String green, String blue){

  RGB color = (RGB){(byte)red.toInt(), (byte)green.toInt(), (byte)blue.toInt()};

  return color;
}

RGB getColor(int red, int green, int blue){

  RGB color = (RGB){(byte)red, (byte)green, (byte)blue};

  return color;
}

RGB stringToRGB(String str){
  int color[3];
  int StringCount = 0;

  while (str.length() > 0)
  {
    int index = str.indexOf(",");
    if (index == -1) // No space found
    {
      color[StringCount++] = str.toInt();
      break;
    }
    else
    {
      color[StringCount++] = str.substring(0, index).toInt();
      str = str.substring(index+1);
    }
  }

  return RGB{(byte)color[0], (byte)color[1], (byte)color[2]};  
}

void printRGB(String texto, RGB color){
  Serial.print(texto);
  Serial.print(color.r);
  Serial.print(", ");
  Serial.print(color.g);
  Serial.print(", ");
  Serial.println(color.b);
}
